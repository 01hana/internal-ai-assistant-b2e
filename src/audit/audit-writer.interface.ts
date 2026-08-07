import { AnswerDecisionStatus, RiskLevel } from '../generated/prisma/enums';
import { Prisma } from '../generated/prisma/client';
import { CustomerScope } from '../identity/customer-scope.types';

export interface AuditWriter {
  append(input: AppendAuditEventInput, database?: AuditTransactionClient): Promise<AuditEventRecord>;
}

export type AuditTransactionClient = Pick<
  Prisma.TransactionClient,
  'assistantSession' | 'assistantMessage' | 'toolCall' | 'evidenceRef' | 'auditEvent'
>;

export interface AppendAuditEventInput {
  customerScope: CustomerScope;
  requestId: string;
  eventType: string;
  sessionId?: string;
  messageId?: string;
  decision?: AnswerDecisionStatus;
  toolCallId?: string;
  riskLevel?: RiskLevel;
  permissionResult?: Prisma.InputJsonValue;
  evidenceRefIds?: string[];
  durationMs?: number;
  metadata?: Prisma.InputJsonValue;
}

export interface AuditEventRecord {
  id: string;
  timestamp: Date;
  customerId: string;
  requestId: string;
  organizationId: string;
  hostApp: string;
  actorId: string;
  eventType: string;
  sessionId?: string;
  messageId?: string;
  decision?: AnswerDecisionStatus;
  toolCallId?: string;
  riskLevel?: RiskLevel;
  permissionResult?: Prisma.InputJsonValue;
  evidenceRefIds: string[];
  durationMs?: number;
  metadata?: Prisma.InputJsonValue;
}

export interface AppendCustomerToolAuditInput {
  customerScope: CustomerScope;
  requestId: string;
  eventType: string;
  sessionId?: string;
  messageId?: string;
  toolCallId?: string;
  riskLevel?: RiskLevel;
  durationMs?: number;
  metadata?: Prisma.InputJsonValue;
}

export interface AppendCustomerWorkflowAuditInput {
  customerScope: CustomerScope;
  requestId: string;
  eventType: string;
  sessionId?: string;
  messageId?: string;
  toolCallId?: string;
  riskLevel?: RiskLevel;
  metadata?: Prisma.InputJsonValue;
}
