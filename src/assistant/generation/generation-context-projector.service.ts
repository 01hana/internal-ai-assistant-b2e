import { Injectable } from '@nestjs/common';
import { ConversationSourceGuard } from '../conversation/conversation-source-guard';
import type { BoundedConversationContext, ConversationScope } from '../conversation/conversation.types';
import type { GroundedContextBundleV1, GroundedDocumentEvidence, GroundedToolEvidence } from '../grounding/grounded-context-bundle.types';
import type { PriorGroundedContextResult } from '../grounding/prior-grounded-context.service';
import type { GroundedGenerationContextV1 } from './grounded-generation.types';

const KIB = 1024;
const LIMITS = Object.freeze({ total: 16 * KIB, current: 2 * KIB, prior: 4 * KIB, document: 6 * KIB, tool: 3 * KIB, metadata: KIB });
const MAX_CONSERVATIVE_INPUT_TOKENS = 16_384;
const MAX_EXCHANGES = 4;
const PLACEHOLDER = 'Pending answer.';

export interface GenerationProjectionScope extends ConversationScope { readonly integrationId: string }
export interface GenerationContextProjectionInput {
  readonly scope: GenerationProjectionScope;
  readonly context: BoundedConversationContext;
  readonly bundle: GroundedContextBundleV1;
  /** Current-request result of the existing prior-evidence freshness and authorization service. */
  readonly priorGroundedContext?: PriorGroundedContextResult;
}

@Injectable()
export class GenerationContextProjectorService {
  private readonly guard = new ConversationSourceGuard();

  project(input: GenerationContextProjectionInput): GroundedGenerationContextV1 {
    const { scope, context, bundle } = input;
    if (!sameScope(scope, context.scope) || bundle.version !== '1' ||
      (bundle.retrieval.coverage !== 'COMPLETE' && bundle.retrieval.coverage !== 'PARTIAL')) invalid();
    const current = safeText(this.guard, bundle.currentRequest.normalizedQuestion);
    if (!current) invalid();
    const question = truncateText(current, LIMITS.current - byteLength(JSON.stringify({ trustClass: 'UNTRUSTED_USER_TEXT', text: '' })));
    if (!question) invalid();

    const needIndex = new Map(bundle.retrieval.requestedNeeds.map((need, index) => [need.id, index]));
    const covered = new Set(bundle.retrieval.needResults.filter((need) => need.status === 'COVERED').map((need) => need.needId));
    if (covered.size === 0) invalid();
    const priorIds = new Set(context.evidenceRefIds);
    const revalidatedIds = new Set(input.priorGroundedContext?.evidence.map((item) => item.evidenceRefId) ?? []);
    const citations = [...bundle.citations].sort((a, b) =>
      (needIndex.get(a.needId) ?? Infinity) - (needIndex.get(b.needId) ?? Infinity) || a.evidenceRefId.localeCompare(b.evidenceRefId));
    const evidenceById = new Map(bundle.evidence.map((item) => [item.evidenceRefId, item]));
    const documentEvidence: GroundedGenerationContextV1['documentEvidence'][number][] = [];
    const toolEvidence: GroundedGenerationContextV1['toolEvidence'][number][] = [];
    const acceptedCitations: string[] = [];
    const acceptedRefs: string[] = [];

    for (const citation of citations) {
      const evidence = evidenceById.get(citation.evidenceRefId);
      const need = bundle.retrieval.needResults.find((item) => item.needId === citation.needId);
      if (!covered.has(citation.needId) || !need?.evidenceRefIds.includes(citation.evidenceRefId) ||
        !evidence || evidence.needId !== citation.needId || evidence.kind !== citation.sourceKind ||
        !citation.citationId || !citation.evidenceRefId) invalid();
      if (priorIds.has(citation.evidenceRefId) && !revalidatedIds.has(citation.evidenceRefId)) invalid();
      if (evidence.kind === 'DOCUMENT') {
        const item = projectDocument(this.guard, evidence, citation.citationId);
        if (byteLength(JSON.stringify([...documentEvidence, item])) > LIMITS.document) invalid();
        documentEvidence.push(item);
      } else {
        const item = projectTool(this.guard, evidence, citation.citationId);
        if (byteLength(JSON.stringify([...toolEvidence, item])) > LIMITS.tool) invalid();
        toolEvidence.push(item);
      }
      acceptedCitations.push(citation.citationId);
      acceptedRefs.push(citation.evidenceRefId);
    }
    if ([...covered].some((needId) => !citations.some((item) => item.needId === needId))) invalid();

    const selectedExchangeIds = new Set(context.exchanges.map((exchange) => exchange.exchangeId));
    const eligible = (context.completedAssistantAnswers ?? []).filter((exchange) =>
      Boolean(exchange.assistantText && exchange.userText && exchange.assistantText !== PLACEHOLDER &&
        selectedExchangeIds.has(exchange.exchangeId) && sameIntegration(scope, exchange.capabilityScope)));
    const newest = [...eligible].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.exchangeId.localeCompare(a.exchangeId));
    const selected = newest.slice(0, MAX_EXCHANGES);
    const priorExchanges: GroundedGenerationContextV1['priorExchanges'][number][] = [];
    for (const exchange of selected) {
      const user = safeText(this.guard, exchange.userText);
      const assistant = safeText(this.guard, exchange.assistantText);
      if (!user || !assistant) continue;
      const remaining = Math.min(Math.floor(LIMITS.prior / selected.length), LIMITS.prior - byteLength(JSON.stringify(priorExchanges)));
      if (remaining <= 0) break;
      const overhead = byteLength(JSON.stringify({ userText: '', assistantText: '', trustClass: 'COMPLETED_ASSISTANT_TEXT' })) + 2;
      const perText = Math.floor((remaining - overhead) / 2);
      const turn = { userText: truncateText(user, perText), assistantText: truncateText(assistant, perText), trustClass: 'COMPLETED_ASSISTANT_TEXT' as const };
      if (turn.userText && turn.assistantText && byteLength(JSON.stringify([...priorExchanges, turn])) <= LIMITS.prior) priorExchanges.push(turn);
    }
    priorExchanges.reverse();

    const result: GroundedGenerationContextV1 = {
      version: '1', coverage: bundle.retrieval.coverage,
      currentQuestion: { trustClass: 'UNTRUSTED_USER_TEXT', text: question }, priorExchanges,
      documentEvidence, toolEvidence,
      unsupportedNeeds: bundle.unsupportedNeeds.map((item) => ({ needId: item.needId, reasonCode: item.reasonCode })),
      allowedCitationIds: acceptedCitations, allowedEvidenceRefIds: acceptedRefs
    };
    const metadata = { coverage: result.coverage, unsupportedNeeds: result.unsupportedNeeds,
      allowedCitationIds: result.allowedCitationIds, allowedEvidenceRefIds: result.allowedEvidenceRefIds };
    const serializedBytes = byteLength(JSON.stringify(result));
    // Until a reviewed provider tokenizer exists, one UTF-8 byte costs at least one estimated token.
    const conservativeInputTokens = serializedBytes;
    if (byteLength(JSON.stringify(metadata)) > LIMITS.metadata ||
      byteLength(JSON.stringify(result.currentQuestion)) > LIMITS.current ||
      byteLength(JSON.stringify(result.priorExchanges)) > LIMITS.prior ||
      byteLength(JSON.stringify(result.documentEvidence)) > LIMITS.document ||
      byteLength(JSON.stringify(result.toolEvidence)) > LIMITS.tool ||
      serializedBytes > LIMITS.total || conservativeInputTokens > MAX_CONSERVATIVE_INPUT_TOKENS) invalid();
    return deepFreeze(result);
  }
}

function projectDocument(guard: ConversationSourceGuard, evidence: GroundedDocumentEvidence, citationId: string) {
  const text = safeText(guard, evidence.content);
  if (!text) invalid();
  const base = { evidenceRefId: evidence.evidenceRefId, citationId, trustClass: 'UNTRUSTED_DOCUMENT_EVIDENCE' as const, text: '' };
  const clipped = truncateText(text, LIMITS.document - byteLength(JSON.stringify([base])));
  if (!clipped) invalid();
  return { ...base, text: clipped };
}

function projectTool(guard: ConversationSourceGuard, evidence: GroundedToolEvidence, citationId: string) {
  const facts: Record<string, string | number | boolean | null> = {};
  for (const field of [...evidence.fieldPaths].sort()) {
    if (!Object.prototype.hasOwnProperty.call(evidence.projectedFacts, field)) continue;
    const value = evidence.projectedFacts[field];
    if (value !== null && typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') invalid();
    const checked = guard.guard({ [field]: value });
    if (!checked.accepted) invalid();
    facts[field] = value as string | number | boolean | null;
  }
  if (Object.keys(facts).length === 0) invalid();
  return { evidenceRefId: evidence.evidenceRefId, citationId, trustClass: 'SERVER_PROJECTED_TOOL_EVIDENCE' as const, facts };
}

function sameScope(expected: ConversationScope, actual: ConversationScope): boolean {
  return ['customerId', 'sessionId', 'organizationId', 'hostApp', 'actorId']
    .every((key) => expected[key as keyof ConversationScope] === actual[key as keyof ConversationScope]);
}
function sameIntegration(scope: GenerationProjectionScope, prior: { customerId: string; integrationId: string; hostApp: string } | undefined): boolean {
  return prior?.customerId === scope.customerId && prior.integrationId === scope.integrationId && prior.hostApp === scope.hostApp;
}
function safeText(guard: ConversationSourceGuard, value: unknown): string | undefined {
  const checked = guard.guard(value);
  return checked.accepted && typeof checked.value === 'string' && checked.value.length > 0 ? checked.value : undefined;
}
function truncateText(value: string, maxBytes: number): string {
  if (maxBytes <= 0) return '';
  let result = '';
  for (const scalar of value) {
    if (byteLength(JSON.stringify(result + scalar)) > maxBytes) break;
    result += scalar;
  }
  return result;
}
function byteLength(value: string): number { return Buffer.byteLength(value, 'utf8'); }
function invalid(): never { throw new Error('GENERATION_CONTEXT_INVALID'); }
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}
