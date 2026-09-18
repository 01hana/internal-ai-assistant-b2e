import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ToolRegistryService } from '../../tools/tool-registry.service';
import { ToolPermissionPrecheckService } from '../../permissions/tool-permission-precheck.service';
import type { CustomerScope } from '../../identity/customer-scope.types';
import type { RequestIdentityContext } from '../../identity/identity-context.types';
import type { BoundedConversationContext } from '../conversation/conversation.types';
import type { GroundedRetrievalPlan, GroundedRetrievalNeedResult } from '../../retrieval/grounded-retrieval.types';
import type { GroundedCitation, GroundedDocumentEvidence, GroundedToolEvidence } from './grounded-context-bundle.types';
import { MAX_TOOL_EVIDENCE_AGE_SECONDS } from './prior-grounded-evidence-eligibility.service';
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
    private readonly permission: ToolPermissionPrecheckService
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
        const normalized = need.kind === 'DOCUMENT'
          ? await this.documentEvidence(need.id, persisted, input.customerScope)
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

  private async documentEvidence(needId: string, ref: any, scope: CustomerScope): Promise<GroundedDocumentEvidence | undefined> {
    if (!ref.documentId || !ref.chunkId || !isRecord(ref.summary)) return undefined;
    const document = await this.prisma.db.knowledgeDocument.findFirst({ where: { customerId: scope.customerId, id: ref.documentId, status: KnowledgeDocumentStatus.active } });
    const chunk = await this.prisma.db.knowledgeChunk.findFirst({ where: { customerId: scope.customerId, id: ref.chunkId, documentId: ref.documentId, enabled: true } });
    if (!document || !chunk || ref.summary.documentVersion !== document.version || !documentAccessible(document, scope)) return undefined;
    const required = ['sourceKey', 'documentTitle', 'snippet'];
    if (!required.every((key) => typeof ref.summary[key] === 'string')) return undefined;
    return deepFreeze({ kind: 'DOCUMENT', needId, evidenceRefId: ref.id, content: ref.summary.snippet, title: ref.summary.documentTitle,
      documentId: document.id, chunkId: chunk.id, documentVersion: document.version, sourceKey: ref.summary.sourceKey,
      observedAt: ref.timestamp.toISOString(), trustClass: 'UNTRUSTED_DOCUMENT_EVIDENCE' });
  }

  private async toolEvidence(needId: string, ref: any, input: PriorGroundedContextInput, now: Date): Promise<GroundedToolEvidence | undefined> {
    if (!ref.toolCallId || !ref.entityType || !isRecord(ref.summary) || !isRecord(ref.summary.fields)) return undefined;
    const call = await this.prisma.db.toolCall.findFirst({ where: { customerId: input.customerScope.customerId, id: ref.toolCallId, sessionId: input.sessionId, messageId: ref.messageId } });
    if (!call || call.status !== 'success' || call.executionStatus !== 'executed') return undefined;
    const age = (now.getTime() - ref.timestamp.getTime()) / 1000;
    if (age < 0 || age > MAX_TOOL_EVIDENCE_AGE_SECONDS) return undefined;
    const resolution = await this.tools.resolveToolForCustomer(ref.entityType, input.customerScope);
    if (!resolution.resolved) return undefined;
    const permission = await this.permission.checkResolvedCustomerTool({ requestId: input.requestId, sessionId: input.sessionId,
      messageId: input.responseMessageId, identityContext: input.identityContext, customerScope: input.customerScope, resolvedTool: resolution.resolved });
    if (!permission.allowed) return undefined;
    const fieldPaths = [...ref.fieldPaths];
    if (Object.keys(ref.summary.fields).some((key) => !fieldPaths.includes(key))) return undefined;
    return deepFreeze({ kind: 'TOOL', needId, evidenceRefId: ref.id, toolCallId: call.id, canonicalToolKey: ref.entityType,
      projectedFacts: ref.summary.fields, fieldPaths: Object.freeze(fieldPaths), observedAt: ref.timestamp.toISOString() });
  }
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
