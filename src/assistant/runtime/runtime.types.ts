import { ToolCall } from '../../generated/prisma/client';
import { ToolCallStatus, ToolExecutionStatus } from '../../generated/prisma/enums';
import { RequestIdentityContext } from '../../identity/identity-context.types';
import { PageContextDto } from '../page-context/page-context.dto';
import { PageEntityRef } from '../page-context/page-context.types';
import { PersistedExecutionPlan } from '../planning/assistant-planning.types';

export interface StructuredOrderRecord {
  [key: string]: unknown;
  orderId: string;
  status: string;
  customerName: string;
  amount: number;
}

export interface AssistantReadonlyRuntimeInput {
  executionPlan: PersistedExecutionPlan;
  pageContext?: PageContextDto;
}

export interface AssistantReadonlyRuntimeResult {
  toolName: string;
  entityRef: PageEntityRef;
  visibleFields: string[];
  structuredRecord?: StructuredOrderRecord;
  sanitizedResult: Record<string, unknown>;
}

export interface CreateToolCallInput {
  requestId: string;
  sessionId: string;
  messageId: string;
  identityContext: RequestIdentityContext;
  toolName: string;
  entityId?: string;
  visibleFields: string[];
  sanitizedResult: Record<string, unknown>;
  status?: ToolCallStatus;
  executionStatus?: ToolExecutionStatus;
}

export interface CompletedToolCallResult {
  toolCall: ToolCall;
}
