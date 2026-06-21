import { Prisma } from '../generated/prisma/client';
import { ApprovalRequestStatus, RiskLevel, ToolOperation } from '../generated/prisma/enums';
import { PageContextDto } from '../assistant/page-context/page-context.dto';
import { PersistedExecutionPlan } from '../assistant/planning/assistant-planning.types';
import { RequestIdentityContext } from '../identity/identity-context.types';

export interface CreateApprovalRequestInput {
  requestId: string;
  sessionId: string;
  messageId: string;
  identityContext: RequestIdentityContext;
  executionPlan: PersistedExecutionPlan;
  pageContext?: PageContextDto;
}

export interface ApprovalRequestDecisionInput {
  requestId: string;
  approvalRequestId: string;
  identityContext: RequestIdentityContext;
  idempotencyKey?: string;
  reason?: string;
}

export interface ListApprovalRequestsInput {
  requestId: string;
  identityContext: RequestIdentityContext;
  filters: ApprovalRequestListFilters;
}

export interface ApprovalRequestListFilters {
  status?: ApprovalRequestStatus;
  riskLevel?: RiskLevel;
  requesterActorId?: string;
  approverActorId?: string;
  createdAtFrom?: string;
  createdAtTo?: string;
}

export interface ApprovalRequestResponse {
  approvalRequestId: string;
  status: ApprovalRequestStatus;
  riskLevel: RiskLevel;
  requesterActorId: string;
  approverActorId: string | null;
  actionSummary: Prisma.JsonValue;
  payloadSummary: Prisma.JsonValue;
  evidenceRefIds: string[];
  expiresAt: string | null;
  requestId: string;
  messageId: string | null;
  decisionReason?: string | null;
  decidedAt?: string | null;
  duplicateSafe?: boolean;
  executionStatus?: string;
}

export interface ApprovalRequestPreview {
  toolName: string;
  resource: string;
  operation: ToolOperation;
  entityType: string | null;
  entityId: string | null;
}
