import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ToolRegistryService } from '../../tools/tool-registry.service';
import { ToolPermissionPrecheckService } from '../../permissions/tool-permission-precheck.service';
import type { CustomerScope } from '../../identity/customer-scope.types';
import type { RequestIdentityContext } from '../../identity/identity-context.types';
import type { BoundedConversationContext } from '../conversation/conversation.types';
import type { GroundedRetrievalPlan, GroundedRetrievalNeedResult } from '../../retrieval/grounded-retrieval.types';
import type { GroundedCitation, GroundedDocumentEvidence, GroundedToolEvidence } from './grounded-context-bundle.types';
import { PriorGroundedEvidenceEligibilityService } from './prior-grounded-evidence-eligibility.service';
import { KnowledgeDocumentStatus, KnowledgeVisibility } from '../../generated/prisma/enums';

export interface PriorGroundedContextInput {
  readonly plan: GroundedRetrievalPlan;
  readonly context?: BoundedConversationContext;
  readonly customerScope: CustomerScope;
  readonly identityContext: RequestIdentityContext;
  readonly requestId: string;
  readonly sessionId: string;
  readonly sourceMessageId: string;
  readonly responseMessageId: string;
}

export interface PriorGroundedContextResult {
  readonly complete: boolean;
  readonly needResults: readonly GroundedRetrievalNeedResult[];
  readonly evidence: readonly (GroundedDocumentEvidence | GroundedToolEvidence)[];
  readonly citations: readonly GroundedCitation[];
}

@Injectable()
export class PriorGroundedContextService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tools: ToolRegistryService,
    private readonly permission: ToolPermissionPrecheckService,
    private readonly eligibility: PriorGroundedEvidenceEligibilityService
  ) {}

  async resolve(input: PriorGroundedContextInput): Promise<PriorGroundedContextResult> {
    const candidates = input.context?.evidenceRefs ?? [];
    if (candidates.length === 0) return empty();
    const currentMessage = await this.prisma.db.assistantMessage.findFirst({
      where: { customerId: input.customerScope.customerId, id: input.sourceMessageId, sessionId: input.sessionId }
    });
    const now = currentMessage?.createdAt ?? new Date();
    const used = new Set<string>();
    const needResults: GroundedRetrievalNeedResult[] = [];
    const evidence: Array<GroundedDocumentEvidence | GroundedToolEvidence> = [];
    const citations: GroundedCitation[] = [];
    for (const need of input.plan.needs) {
      if (need.kind === 'UNSUPPORTED') continue;
      for (const candidate of candidates) {
        if (used.has(candidate.id) || (need.kind === 'DOCUMENT' && candidate.sourceType !== 'document_chunk') ||
          (need.kind === 'TOOL' && candidate.sourceType !== 'structured_record')) continue;
        const persisted = (await this.prisma.db.evidenceRef.findMany({
          where: { customerId: input.customerScope.customerId, id: candidate.id, messageId: candidate.messageId }
        }))[0];
        if (!persisted || !persisted.messageId) continue;
        const decision = await this.prisma.db.answerDecision.findFirst({
          where: { customerId: input.customerScope.customerId, messageId: persisted.messageId, status: 'answered' }
        });
        const grounding = await this.prisma.db.groundingCheck.findFirst({
          where: { customerId: input.customerScope.customerId, messageId: persisted.messageId, covered: true, unsupportedClaimCount: 0 }
        });
        if (!decision || !grounding || !Array.isArray(grounding.evidenceRefIds) || !grounding.evidenceRefIds.includes(persisted.id)) continue;
        const linkedExchange = input.context?.exchanges.find((exchange) => exchange.evidenceRefIds.includes(candidate.id));
        const priorFrame = linkedExchange?.semanticFrame;
        if (!semanticallyCompatible(need, persisted, priorFrame, Boolean(linkedExchange), input.plan.resolvedFrame)) continue;
        const normalized = need.kind === 'DOCUMENT'
          ? await this.documentEvidence(need.id, persisted, input)
          : await this.toolEvidence(need.id, persisted, input, now);
        if (!normalized) continue;
        used.add(candidate.id); evidence.push(normalized);
        needResults.push(frozen({ needId: need.id, status: 'COVERED', evidenceRefIds: Object.freeze([persisted.id]) }));
        citations.push(frozen({ citationId: `citation-${need.id}-1`, evidenceRefId: persisted.id, needId: need.id, sourceKind: need.kind, safeLabel: normalized.kind === 'DOCUMENT' ? normalized.title : normalized.canonicalToolKey }));
        break;
      }
    }
    return deepFreeze({ complete: needResults.length === input.plan.needs.length && input.plan.needs.length > 0, needResults: Object.freeze(needResults), evidence: Object.freeze(evidence), citations: Object.freeze(citations) });
  }

  private async documentEvidence(needId: string, ref: any, input: PriorGroundedContextInput): Promise<GroundedDocumentEvidence | undefined> {
    if (!ref.documentId || !ref.chunkId || !isRecord(ref.summary)) return undefined;
    const document = await this.prisma.db.knowledgeDocument.findFirst({ where: { customerId: input.customerScope.customerId, id: ref.documentId, status: KnowledgeDocumentStatus.active } });
    const chunk = await this.prisma.db.knowledgeChunk.findFirst({ where: { customerId: input.customerScope.customerId, id: ref.chunkId, documentId: ref.documentId, enabled: true } });
    const accessible = Boolean(document && documentAccessible(document, input.customerScope));
    const eligibility = this.eligibility.evaluate({
      evidence: { kind: 'DOCUMENT', evidenceRefId: ref.id, needId, scope: currentScope(input), documentId: ref.documentId,
        chunkId: ref.chunkId, documentVersion: ref.summary.documentVersion, groundingCovered: true, metadata: ref.summary },
      currentScope: currentScope(input),
      currentDocument: document ? { active: document.status === KnowledgeDocumentStatus.active, chunkEnabled: chunk?.enabled === true,
        version: document.version, visible: accessible, accessible, permissionAllowed: accessible } : undefined
    });
    if (!eligibility.eligible || !document || !chunk) return undefined;
    const required = ['sourceKey', 'documentTitle', 'snippet'];
    if (!required.every((key) => typeof ref.summary[key] === 'string')) return undefined;
    return deepFreeze({ kind: 'DOCUMENT', needId, evidenceRefId: ref.id, content: ref.summary.snippet, title: ref.summary.documentTitle,
      documentId: document.id, chunkId: chunk.id, documentVersion: document.version, sourceKey: ref.summary.sourceKey,
      observedAt: ref.timestamp.toISOString(), trustClass: 'UNTRUSTED_DOCUMENT_EVIDENCE' });
  }

  private async toolEvidence(needId: string, ref: any, input: PriorGroundedContextInput, now: Date): Promise<GroundedToolEvidence | undefined> {
    if (!ref.toolCallId || !ref.entityType || !isRecord(ref.summary) || !isRecord(ref.summary.fields)) return undefined;
    const call = await this.prisma.db.toolCall.findFirst({ where: { customerId: input.customerScope.customerId, id: ref.toolCallId, sessionId: input.sessionId, messageId: ref.messageId } });
    if (!call) return undefined;
    const resolution = await this.tools.resolveToolForCustomer(ref.entityType, input.customerScope);
    const permission = resolution.resolved ? await this.permission.checkResolvedCustomerTool({ requestId: input.requestId, sessionId: input.sessionId,
      messageId: input.responseMessageId, identityContext: input.identityContext, customerScope: input.customerScope, resolvedTool: resolution.resolved })
      : undefined;
    const fieldPaths = [...ref.fieldPaths];
    if (Object.keys(ref.summary.fields).some((key) => !fieldPaths.includes(key))) return undefined;
    const eligibility = this.eligibility.evaluate({
      evidence: { kind: 'TOOL', evidenceRefId: ref.id, needId, scope: currentScope(input), status: call.status,
        executionStatus: call.executionStatus, projectionStatus: 'succeeded', evidenceAttached: true,
        projectedFacts: ref.summary.fields, declaredFieldPaths: fieldPaths, groundingCovered: true,
        observedAt: ref.timestamp.toISOString(), metadata: ref.summary },
      currentScope: currentScope(input), now: now.toISOString(), currentAuthorization: {
        toolDefinitionActive: Boolean(resolution.resolved), policyAllowed: Boolean(resolution.resolved), permissionAllowed: permission?.allowed === true
      }
    });
    if (!eligibility.eligible) return undefined;
    return deepFreeze({ kind: 'TOOL', needId, evidenceRefId: ref.id, toolCallId: call.id, canonicalToolKey: ref.entityType,
      projectedFacts: ref.summary.fields, fieldPaths: Object.freeze(fieldPaths), observedAt: ref.timestamp.toISOString() });
  }
}

function currentScope(input: PriorGroundedContextInput) {
  return { customerId: input.customerScope.customerId, sessionId: input.sessionId,
    organizationId: input.customerScope.organizationId, hostApp: input.customerScope.hostApp, actorId: input.customerScope.actorId };
}

function semanticallyCompatible(need: GroundedRetrievalPlan['needs'][number], ref: any, priorFrame: any, linkedExchange: boolean, resolvedFrame: any): boolean {
  const referencesPrior = hasInheritedDimension(resolvedFrame) ||
    (need.kind === 'DOCUMENT' && /(剛才|剛剛|前面|再列一次|引用的文件|文件證據)/.test(need.query));
  if (!referencesPrior) return false;
  if (need.kind === 'DOCUMENT') {
    const requestedFamily = documentFamily([need.topicKey, need.query]);
    const evidenceFamily = documentFamily([priorFrame?.resource?.value, priorFrame?.metricOrAspect?.value,
      ref.summary?.sourceKey, ref.summary?.documentTitle, ref.summary?.heading]);
    if (requestedFamily && evidenceFamily) return requestedFamily === evidenceFamily;
    if (/(剛才|剛剛|前面|再列一次)/.test(need.query) && /SOP|文件|規定|政策/i.test(need.query)) return linkedExchange;
    return Boolean(need.topicKey && priorFrame?.topicKey && need.topicKey === priorFrame.topicKey);
  }
  if (need.kind !== 'TOOL') return false;
  if (!priorFrame) return false;
  const current = need.frame;
  if (current.resource?.value && priorFrame.resource?.value && current.resource.value !== priorFrame.resource.value) return false;
  if (current.entity?.entityType && priorFrame.entity?.entityType && current.entity.entityType !== priorFrame.entity.entityType) return false;
  if (current.entity?.value && priorFrame.entity?.value && current.entity.value !== priorFrame.entity.value) return false;
  return Boolean(current.resource || current.entity || current.topicKey) && Boolean(priorFrame.resource || priorFrame.entity || priorFrame.topicKey);
}

function hasInheritedDimension(frame: any): boolean {
  return ['resource', 'intent', 'metricOrAspect', 'timeRange', 'entity'].some((name) => frame?.[name]?.source === 'inherited');
}

function documentFamily(values: readonly unknown[]): string | undefined {
  const text = values.filter((value): value is string => typeof value === 'string').join(' ').toLowerCase();
  if (/travelsubsidy|旅遊|補助/.test(text)) return 'travel-subsidy';
  if (/退貨|return|sop-return/.test(text)) return 'return-sop';
  return undefined;
}

function documentAccessible(document: any, scope: CustomerScope): boolean {
  const organizations = Array.isArray(document.organizationIds) ? document.organizationIds : [];
  const requiredScopes = Array.isArray(document.requiredPermissionScopes) ? document.requiredPermissionScopes : [];
  const visible = document.visibility === KnowledgeVisibility.CUSTOMER ? organizations.length === 0
    : document.visibility === KnowledgeVisibility.ORGANIZATION && organizations.includes(scope.organizationId);
  return visible && requiredScopes.every((permission: string) => scope.permissionScopes.includes(permission));
}
function empty(): PriorGroundedContextResult { return deepFreeze({ complete: false, needResults: Object.freeze([]), evidence: Object.freeze([]), citations: Object.freeze([]) }); }
function isRecord(value: unknown): value is Record<string, any> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function frozen<T>(value: T): T { return Object.freeze(value); }
function deepFreeze<T>(value: T): T { if (value && typeof value === 'object') { for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested); if (!Object.isFrozen(value)) Object.freeze(value); } return value; }
