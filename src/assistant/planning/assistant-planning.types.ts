import { Prisma } from '../../generated/prisma/client';
import { ExecutionDecision, RiskLevel } from '../../generated/prisma/enums';
import { RequestIdentityContext } from '../../identity/identity-context.types';
import { CustomerScope } from '../../identity/customer-scope.types';
import {
  PersistedQueryUnderstandingResult,
  QueryUnderstandingContextStateSnapshot,
  QueryUnderstandingOutput
} from '../../query-understanding/query-understanding.types';

export interface AssistantPlanningInput {
  customerScope: CustomerScope;
  requestId: string;
  sessionId: string;
  messageId: string;
  text: string;
  identityContext: RequestIdentityContext;
  pageContext?: Prisma.InputJsonValue;
  assistantContextState?: QueryUnderstandingContextStateSnapshot;
}

export interface AssistantPlanningResult {
  queryUnderstanding: QueryUnderstandingOutput;
  persistedQueryUnderstanding: PersistedQueryUnderstandingResult;
  executionPlan: PersistedExecutionPlan;
  decision: ExecutionDecision;
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
