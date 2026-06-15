import { Prisma } from '../generated/prisma/client';
import { ExecutionDecision, RiskLevel } from '../generated/prisma/enums';
import { RequestIdentityContext } from '../identity/identity-context.types';
import { PersistedQueryUnderstandingResult, QueryUnderstandingOutput } from '../query-understanding/query-understanding.types';

export interface AssistantPlanningInput {
  requestId: string;
  sessionId: string;
  messageId: string;
  text: string;
  identityContext: RequestIdentityContext;
  pageContext?: Prisma.InputJsonValue;
}

export interface AssistantPlanningResult {
  queryUnderstanding: QueryUnderstandingOutput;
  persistedQueryUnderstanding: PersistedQueryUnderstandingResult;
  executionPlan: PersistedExecutionPlan;
  decision: ExecutionDecision;
}

export interface PersistedExecutionPlan {
  id: string;
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
