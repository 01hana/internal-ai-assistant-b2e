import { Injectable } from '@nestjs/common';
import type { GroundedCitation, GroundedToolEvidence } from './grounded-context-bundle.types';
import type { ToolRetrievalNeed, GroundedRetrievalNeedResult } from '../../retrieval/grounded-retrieval.types';
import type { CustomerScope } from '../../identity/customer-scope.types';
import type { RequestIdentityContext } from '../../identity/identity-context.types';
import type { HostIntegrationContext, TransientConnectorContext } from '../../host-integration/host-integration.types';
import type { NormalizedPageContext } from '../page-context/page-context.types';
import type { PersistedExecutionPlan } from '../planning/assistant-planning.types';
import { AssistantReadonlyRuntimeService } from '../runtime/assistant-readonly-runtime.service';
import { EvidenceRefService } from '../../evidence/evidence-ref.service';
import { PrismaService } from '../../prisma/prisma.service';
import { GroundedToolEvidenceNormalizer } from './grounded-tool-evidence.normalizer';
import type { ToolPermissionDeniedReason } from '../../tools/tool-registry.types';

export interface GroundedToolRetrievalInput {
  readonly requestId: string;
  readonly sessionId: string;
  readonly sourceMessageId: string;
  readonly responseMessageId: string;
  readonly identityContext: RequestIdentityContext;
  readonly customerScope: CustomerScope;
  readonly hostIntegrationContext: HostIntegrationContext;
  readonly pageContext?: NormalizedPageContext;
  readonly transientConnectorContext: TransientConnectorContext;
  readonly executionPlan: PersistedExecutionPlan;
  readonly need: ToolRetrievalNeed;
}

export interface GroundedToolRetrievalResult {
  readonly needResult: GroundedRetrievalNeedResult;
  readonly evidence: readonly GroundedToolEvidence[];
  readonly citations: readonly GroundedCitation[];
  readonly toolCallId?: string;
  readonly toolName?: string;
  readonly toolLifecycle?: 'completed' | 'blocked' | 'failed';
  readonly deniedReason?: ToolPermissionDeniedReason;
  readonly errorCode?: string;
}

@Injectable()
export class GroundedToolRetrievalService {
  constructor(
    private readonly runtime: AssistantReadonlyRuntimeService,
    private readonly evidenceRefs: EvidenceRefService,
    private readonly prisma: PrismaService,
    private readonly normalizer: GroundedToolEvidenceNormalizer
  ) {}

  async execute(input: GroundedToolRetrievalInput): Promise<GroundedToolRetrievalResult> {
    if (!hasExactlyOneCurrentCandidate(input.executionPlan.candidateTools)) {
      return result(input.need.id, 'UNSUPPORTED', 'TOOL_CURRENT_DISCOVERY_REQUIRED');
    }
    const runtime = await this.runtime.execute({
      customerScope: input.customerScope, requestId: input.requestId, sessionId: input.sessionId,
      sourceMessageId: input.sourceMessageId, responseMessageId: input.responseMessageId,
      identityContext: input.identityContext, hostIntegrationContext: input.hostIntegrationContext,
      executionPlan: input.executionPlan, pageContext: input.pageContext,
      transientConnectorContext: input.transientConnectorContext
    });
    const lifecycle = {
      ...(runtime.toolCallId ? { toolCallId: runtime.toolCallId } : {}), toolName: runtime.toolName,
      toolLifecycle: runtime.toolLifecycle, ...(runtime.deniedReason ? { deniedReason: runtime.deniedReason } : {}),
      ...(runtime.connectorErrorCode ? { errorCode: runtime.connectorErrorCode } : {})
    };
    if (runtime.toolLifecycle !== 'completed' || !runtime.projectedResult || !runtime.toolCallId) {
      return { ...result(input.need.id, runtime.toolLifecycle === 'blocked' ? 'UNSUPPORTED' : 'FAILED', runtime.deniedReason ?? runtime.connectorErrorCode ?? 'TOOL_EXECUTION_FAILED'), ...lifecycle };
    }
    const attached = await this.evidenceRefs.attachStructuredRecordEvidence({
      requestId: input.requestId, sessionId: input.sessionId, messageId: input.responseMessageId,
      toolCallId: runtime.toolCallId, customerScope: input.customerScope, projectedResult: runtime.projectedResult
    });
    if (!attached) return { ...result(input.need.id, 'UNSUPPORTED', 'PROJECTED_TOOL_EVIDENCE_NOT_FOUND'), ...lifecycle };
    const persisted = await this.prisma.db.toolCall.findFirst({
      where: { customerId: input.customerScope.customerId, id: runtime.toolCallId, sessionId: input.sessionId, messageId: input.responseMessageId }
    });
    const evidence = this.normalizer.normalize({
      needId: input.need.id, evidenceRefId: attached.id, toolCallId: runtime.toolCallId,
      canonicalToolKey: runtime.projectedResult.canonicalToolKey,
      status: persisted?.status ?? '', executionStatus: persisted?.executionStatus ?? '',
      projectionStatus: 'succeeded', answerDecisionStatus: 'answered', groundingCovered: true,
      evidenceAttached: true, projectedFacts: runtime.projectedResult.facts,
      declaredFieldPaths: runtime.projectedResult.fieldPaths,
      observedAt: attached.observedAt ?? new Date().toISOString()
    });
    return deepFreeze({
      needResult: needResult(input.need.id, 'COVERED', [attached.id]), evidence: Object.freeze([evidence]),
      citations: Object.freeze([this.normalizer.createCitation(evidence)]), ...lifecycle
    });
  }
}

function hasExactlyOneCurrentCandidate(value: unknown): boolean {
  return Array.isArray(value) && value.length === 1 && value[0] !== null && typeof value[0] === 'object';
}
function needResult(needId: string, status: GroundedRetrievalNeedResult['status'], evidenceRefIds: readonly string[], reasonCode?: string): GroundedRetrievalNeedResult {
  return deepFreeze({ needId, status, evidenceRefIds: Object.freeze([...evidenceRefIds]), ...(reasonCode ? { reasonCode } : {}) });
}
function result(needId: string, status: GroundedRetrievalNeedResult['status'], reasonCode: string): GroundedToolRetrievalResult {
  return deepFreeze({ needResult: needResult(needId, status, [], reasonCode), evidence: Object.freeze([]), citations: Object.freeze([]) });
}
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
    if (!Object.isFrozen(value)) Object.freeze(value);
  }
  return value;
}
