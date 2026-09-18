import { Prisma } from '../../generated/prisma/client';
import { ExecutionDecision, RiskLevel } from '../../generated/prisma/enums';
import { CustomerScope } from '../../identity/customer-scope.types';
import { HostIntegrationContext } from '../../host-integration/host-integration.types';
import { NormalizedPageContext } from '../page-context/page-context.types';
import {
  PersistedQueryUnderstandingResult,
  QueryUnderstandingContextStateSnapshot,
  QueryUnderstandingOutput
} from '../../query-understanding/query-understanding.types';
import type { GroundedRetrievalPlan } from '../../retrieval/grounded-retrieval.types';
import type { BoundedConversationContext } from '../conversation/conversation.types';

export interface AssistantPlanningInput {
  customerScope: CustomerScope;
  requestId: string;
  sessionId: string;
  messageId: string;
  text: string;
  hostIntegrationContext: HostIntegrationContext;
  pageContext?: NormalizedPageContext;
  assistantContextState?: QueryUnderstandingContextStateSnapshot;
}

export interface AssistantPlanningResult {
  queryUnderstanding: QueryUnderstandingOutput;
  persistedQueryUnderstanding: PersistedQueryUnderstandingResult;
  executionPlan: PersistedExecutionPlan;
  decision: ExecutionDecision;
  groundedRetrievalPlan?: GroundedRetrievalPlan;
  priorConversationContext?: BoundedConversationContext;
}

export interface PlannedOperationCandidate {
  key: string;
  arguments: Record<string, unknown>;
  reason: string;
}

export interface PersistedExecutionPlan {
  id: string;
  customerId: string;
  sessionId: string;
  messageId?: string;
  taskType: string;
  requiredEvidence: Prisma.JsonValue;
  candidateTools: Prisma.JsonValue;
  permissionChecks: Prisma.JsonValue;
  riskAssessment: RiskLevel;
  clarificationNeeds: Prisma.JsonValue | null;
  expectedAnswerShape: Prisma.JsonValue | null;
  requiresMultiStepToolUse: boolean;
  decision: ExecutionDecision;
  createdAt: Date;
}
