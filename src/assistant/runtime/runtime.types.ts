import { ToolCall } from '../../generated/prisma/client';
import { RiskLevel, ToolCallStatus, ToolExecutionStatus } from '../../generated/prisma/enums';
import { RequestIdentityContext } from '../../identity/identity-context.types';
import { PageContextDto } from '../page-context/page-context.dto';
import { PageEntityRef } from '../page-context/page-context.types';
import { PersistedExecutionPlan } from '../planning/assistant-planning.types';
import { ToolPermissionDeniedReason } from '../../tools/tool-registry.types';

export interface StructuredBusinessRecord {
  [key: string]: unknown;
}

export interface AssistantReadonlyRuntimeInput {
  requestId: string;
  sessionId: string;
  messageId: string;
  identityContext: RequestIdentityContext;
  executionPlan: PersistedExecutionPlan;
  pageContext?: PageContextDto;
}

export interface AssistantReadonlyRuntimeResult {
  toolName: string;
  toolVersion: string;
  riskLevel: RiskLevel;
  entityRef: PageEntityRef;
  visibleFields: string[];
  structuredRecord?: StructuredBusinessRecord;
  sanitizedResult: Record<string, unknown>;
  deniedReason?: ToolPermissionDeniedReason;
}

export interface CreateToolCallInput {
  requestId: string;
  sessionId: string;
  messageId: string;
  identityContext: RequestIdentityContext;
  toolName: string;
  toolVersion?: string;
  entityId?: string;
  visibleFields: string[];
  sanitizedResult: Record<string, unknown>;
  status?: ToolCallStatus;
  executionStatus?: ToolExecutionStatus;
}

export interface CompletedToolCallResult {
  toolCall: ToolCall;
}
