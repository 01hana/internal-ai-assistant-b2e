import { Inject, Injectable } from '@nestjs/common';
import { AuditWriterService } from '../audit/audit-writer.service';
import { AssistantMessageRole } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { CapabilityCatalogRegistry } from '../capabilities/capability-catalog.registry';
import { QUERY_SCOPE_ACTIVATIONS, QUERY_SCOPE_REGISTRATIONS, QueryScopeActivation,
  QueryScopeDecision, QueryScopeEvaluationInput, QueryScopeRegistration,
  PreCandidateQueryScopeApplicabilityV1 } from './query-scope.types';

const UNAVAILABLE: QueryScopeDecision = Object.freeze({ outcome: 'DENY', reason: 'QUERY_SCOPE_POLICY_UNAVAILABLE' });

@Injectable()
export class QueryScopeValidationService {
  constructor(
    @Inject(QUERY_SCOPE_ACTIVATIONS) private readonly activations: readonly QueryScopeActivation[],
    @Inject(QUERY_SCOPE_REGISTRATIONS) private readonly registrations: readonly QueryScopeRegistration[],
    private readonly prisma: PrismaService,
    private readonly audit: AuditWriterService,
    private readonly catalogs: CapabilityCatalogRegistry
  ) {}

  async evaluate(input: QueryScopeEvaluationInput): Promise<QueryScopeDecision> {
    return this.evaluateExact(input, false);
  }

  async evaluatePreCandidate(input: Omit<QueryScopeEvaluationInput,
    'capabilityKey' | 'bindingId' | 'toolKey' | 'toolVersion'> & Readonly<{
      applicability: PreCandidateQueryScopeApplicabilityV1;
    }>): Promise<QueryScopeDecision> {
    const evidence = input.applicability;
    if (evidence.version !== '1' || evidence.evidenceSource !== 'CURRENT_SCOPED_SEMANTIC' ||
      evidence.sourceMessageId !== input.sourceMessageId ||
      evidence.scope.customerId !== input.customerScope.customerId ||
      evidence.scope.integrationId !== input.customerScope.integrationId ||
      evidence.scope.hostApp !== input.customerScope.hostApp ||
      evidence.scope.integrationId !== input.integrationId || evidence.scope.hostApp !== input.hostApp) {
      return { outcome: 'NOT_APPLICABLE' };
    }
    const selected = this.catalogs.resolveCatalog(evidence.scope);
    if (!selected.available || selected.catalog.packId !== evidence.packId ||
      selected.catalog.packVersion !== evidence.packVersion ||
      !selected.catalog.capabilities.some((capability) => capability.active &&
        capability.capabilityKey === evidence.capabilityKey) ||
      !selected.catalog.bindings.some((binding) => binding.active &&
        binding.capabilityKey === evidence.capabilityKey && binding.bindingId === evidence.bindingId &&
        binding.bindingVersion === evidence.bindingVersion && binding.target.toolKey === evidence.toolKey &&
        binding.target.toolVersion === evidence.toolVersion)) return { outcome: 'NOT_APPLICABLE' };
    if (!this.activations.some((activation) => activation.customerId === evidence.scope.customerId &&
      activation.integrationId === evidence.scope.integrationId && activation.hostApp === evidence.scope.hostApp &&
      activation.toolKey === evidence.toolKey)) return { outcome: 'NOT_APPLICABLE' };
    return this.evaluateExact({ ...input, capabilityKey: evidence.capabilityKey,
      bindingId: evidence.bindingId, toolKey: evidence.toolKey,
      toolVersion: evidence.toolVersion }, true);
  }

  private previousTurnScopeOutcome(input: QueryScopeEvaluationInput): Promise<'DENY' | 'CLARIFY' | undefined> {
    return previousTurnScopeOutcomeFor(this.prisma, input);
  }

  private async evaluateExact(input: QueryScopeEvaluationInput, denyOnly: boolean): Promise<QueryScopeDecision> {
    const applicable = this.activations.filter((entry) =>
      entry.customerId === input.customerScope.customerId &&
      entry.integrationId === input.customerScope.integrationId &&
      entry.hostApp === input.customerScope.hostApp && entry.toolKey === input.toolKey);
    if (applicable.length === 0) return { outcome: 'NOT_APPLICABLE' };
    const active = applicable.filter((entry) => entry.capabilityKey === input.capabilityKey &&
      entry.bindingId === input.bindingId && entry.toolVersion === input.toolVersion);
    const activation = active.length === 1 ? active[0] : undefined;
    const matching = this.registrations.filter((entry) => activation &&
      entry.customerId === activation.customerId && entry.integrationId === activation.integrationId &&
      entry.hostApp === activation.hostApp && entry.capabilityKey === activation.capabilityKey &&
      entry.bindingId === activation.bindingId && entry.toolKey === activation.toolKey &&
      entry.toolVersion === activation.toolVersion);
    const registration = matching.length === 1 ? matching[0] : undefined;
    let decision: QueryScopeDecision = UNAVAILABLE;
    try {
      const source = await this.prisma.db.assistantMessage.findFirst({
        where: { customerId: input.customerScope.customerId, sessionId: input.sessionId,
          id: input.sourceMessageId, role: AssistantMessageRole.user }
      });
      const previousTurnScopeOutcome = activation && registration?.policy && source
        ? await this.previousTurnScopeOutcome(input) : undefined;
      if (activation && registration?.policy && source && typeof source.content === 'string' && source.content.length <= 4_000 &&
        input.customerScope.customerId === input.identityContext.customer.customerId &&
        input.customerScope.integrationId === input.identityContext.customer.integrationId &&
        input.customerScope.hostApp === input.identityContext.hostApp.hostApp &&
        input.customerScope.organizationId === input.identityContext.organization.organizationId &&
        input.customerScope.actorId === input.identityContext.actor.actorId &&
        input.toolVersion === registration.toolVersion &&
        input.identityContext.customer.integrationId === registration.integrationId &&
        input.identityContext.hostApp.hostApp === registration.hostApp &&
        input.integrationId === input.identityContext.customer.integrationId &&
        input.hostApp === input.identityContext.hostApp.hostApp &&
        input.capabilityKey === registration.capabilityKey && input.bindingId === registration.bindingId &&
        (input.query === undefined || input.query === source.content)) {
        const candidate = await registration.policy.evaluate({ query: source.content,
          customerScope: input.customerScope, identityContext: input.identityContext,
          capabilityKey: registration.capabilityKey, bindingId: registration.bindingId,
          toolKey: registration.toolKey, toolVersion: registration.toolVersion,
          ...(previousTurnScopeOutcome ? { previousTurnScopeOutcome } : {}) });
        if (isValidDecision(candidate)) decision = candidate;
      }
    } catch {
      decision = UNAVAILABLE;
    }
    if (denyOnly && decision.outcome === 'ALLOW') return { outcome: 'NOT_APPLICABLE' };
    await this.audit.append({ customerScope: input.customerScope, requestId: input.requestId,
      sessionId: input.sessionId, messageId: input.sourceMessageId,
      eventType: 'query_scope_validation_completed',
      metadata: { outcome: decision.outcome, reason: decision.reason ?? 'QUERY_SCOPE_POLICY_UNAVAILABLE',
        toolKey: input.toolKey, toolVersion: input.toolVersion,
        ...(denyOnly ? { mode: 'pre_candidate_deny_only' } : {}) } });
    return decision;
  }
}

/** Scope outcome of the user turn immediately before the current one, from this service's own audit trail. */
async function previousTurnScopeOutcomeFor(prisma: PrismaService, input: QueryScopeEvaluationInput): Promise<'DENY' | 'CLARIFY' | undefined> {
  const recent = await prisma.db.assistantMessage.findMany({
    where: { customerId: input.customerScope.customerId, sessionId: input.sessionId, role: AssistantMessageRole.user },
    orderBy: { createdAt: 'desc' }, take: 2, select: { id: true }
  });
  // Only the latest user turn may look back; anything else has no reliable "previous turn".
  if (recent.length < 2 || recent[0].id !== input.sourceMessageId) return undefined;
  const events = await prisma.db.auditEvent.findMany({
    where: { customerId: input.customerScope.customerId, sessionId: input.sessionId, messageId: recent[1].id,
      eventType: 'query_scope_validation_completed' },
    select: { metadata: true }
  });
  const outcomes = events.map((event) => (event.metadata as { outcome?: unknown } | null)?.outcome);
  if (outcomes.includes('DENY')) return 'DENY';
  if (outcomes.includes('CLARIFY')) return 'CLARIFY';
  return undefined;
}

function isValidDecision(value: unknown): value is QueryScopeDecision {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as QueryScopeDecision;
  return (candidate.outcome === 'ALLOW' && candidate.reason === 'QUERY_SCOPE_VALIDATED') ||
    (candidate.outcome === 'CLARIFY' && candidate.reason === 'QUERY_SCOPE_AMBIGUOUS') ||
    (candidate.outcome === 'DENY' && (candidate.reason === 'QUERY_SCOPE_OUTSIDE_AUTHORIZED_SCOPE' ||
      candidate.reason === 'QUERY_SCOPE_TARGET_UNVERIFIED' || candidate.reason === 'QUERY_SCOPE_POLICY_UNAVAILABLE'));
}
