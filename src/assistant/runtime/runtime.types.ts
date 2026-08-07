import { ToolCall } from '../../generated/prisma/client';
import { RiskLevel, ToolCallStatus, ToolExecutionStatus } from '../../generated/prisma/enums';
import { RequestIdentityContext } from '../../identity/identity-context.types';
import { ConnectorExecuteResult } from '../../connectors/connector-adapter.interface';
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
  toolCallId?: string;
  toolLifecycle: 'completed' | 'blocked' | 'failed';
  riskLevel: RiskLevel;
  entityRef: PageEntityRef;
  visibleFields: string[];
  sanitizedResult: Record<string, unknown>;
  deniedReason?: ToolPermissionDeniedReason;
  connectorStatus?: ConnectorExecuteResult['status'];
  connectorErrorCode?: string;
  durationMs?: number;
}

export interface StartToolCallInput {
  requestId: string;
  sessionId: string;
  messageId: string;
  identityContext: RequestIdentityContext;
  toolName: string;
  toolVersion?: string;
  riskLevel?: RiskLevel;
  entityId?: string;
  visibleFields: string[];
}

export interface CompleteToolCallInput {
  toolCallId: string;
  requestId: string;
  sessionId: string;
  messageId: string;
  identityContext: RequestIdentityContext;
  toolName: string;
  toolVersion?: string;
  riskLevel?: RiskLevel;
  visibleFields: string[];
  sanitizedResult: Record<string, unknown>;
  durationMs?: number;
}

export interface FailToolCallInput {
  toolCallId: string;
  requestId: string;
  sessionId: string;
  messageId: string;
  identityContext: RequestIdentityContext;
  toolName: string;
  toolVersion?: string;
  riskLevel?: RiskLevel;
  errorCode: string;
  durationMs?: number;
}

export interface BlockToolCallInput {
  requestId: string;
  sessionId: string;
  messageId: string;
  identityContext: RequestIdentityContext;
  toolName: string;
  toolVersion?: string;
  riskLevel?: RiskLevel;
  entityId?: string;
  visibleFields: string[];
  deniedReason: ToolPermissionDeniedReason;
}

export interface CompletedToolCallResult {
  toolCall: ToolCall;
}

export interface CreateToolCallInput extends StartToolCallInput {
  sanitizedResult: Record<string, unknown>;
  status?: ToolCallStatus;
  executionStatus?: ToolExecutionStatus;
}
