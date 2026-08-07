import { Prisma } from '../generated/prisma/client';
import { ActionDraftStatus, RiskLevel, ToolOperation } from '../generated/prisma/enums';
import { RequestIdentityContext } from '../identity/identity-context.types';
import { CustomerScope } from '../identity/customer-scope.types';
import { PageContextDto } from '../assistant/page-context/page-context.dto';
import { PersistedExecutionPlan } from '../assistant/planning/assistant-planning.types';

export interface CreateActionDraftInput {
  customerScope: CustomerScope;
  requestId: string;
  sessionId: string;
  messageId: string;
  identityContext: RequestIdentityContext;
  executionPlan: PersistedExecutionPlan;
  pageContext?: PageContextDto;
}

export interface ActionDraftResponse {
  actionDraftId: string;
  status: ActionDraftStatus;
  riskLevel: RiskLevel;
  toolName: string;
  resource: string;
  operation: ToolOperation;
  preview: Prisma.JsonValue;
  expiresAt: string | null;
  requestId: string;
  messageId: string | null;
  duplicateSafe?: boolean;
}

export interface ActionDraftDecisionInput {
  customerScope: CustomerScope;
  requestId: string;
  actionDraftId: string;
  identityContext: RequestIdentityContext;
  idempotencyKey?: string;
}
