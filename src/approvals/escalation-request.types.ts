import { Prisma } from '../generated/prisma/client';
import { EscalationReason, EscalationStatus, RiskLevel } from '../generated/prisma/enums';
import { PageContextDto } from '../assistant/page-context/page-context.dto';
import { PersistedExecutionPlan } from '../assistant/planning/assistant-planning.types';
import { RequestIdentityContext } from '../identity/identity-context.types';
import { CustomerScope } from '../identity/customer-scope.types';

export interface CreateEscalationRequestInput {
  customerScope: CustomerScope;
  requestId: string;
  sessionId: string;
  messageId: string;
  identityContext: RequestIdentityContext;
  executionPlan: PersistedExecutionPlan;
  pageContext?: PageContextDto;
}

export interface EscalationRequestDecisionInput {
  customerScope: CustomerScope;
  requestId: string;
  escalationRequestId: string;
  identityContext: RequestIdentityContext;
  reason?: string;
}

export interface ListEscalationRequestsInput {
  customerScope: CustomerScope;
  requestId: string;
  identityContext: RequestIdentityContext;
  filters: EscalationRequestListFilters;
}

export interface EscalationRequestListFilters {
  status?: EscalationStatus;
  riskLevel?: RiskLevel;
  requesterActorId?: string;
}

export interface EscalationRequestResponse {
  escalationRequestId: string;
  status: EscalationStatus;
  reason: EscalationReason;
  ownerType: string;
  summary: Prisma.JsonValue;
  createdAt: string;
  resolvedAt: string | null;
  requestId: string;
  messageId: string | null;
}
