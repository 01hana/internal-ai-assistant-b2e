import { AnswerDecisionStatus, RiskLevel } from '../generated/prisma/enums';
import { Prisma } from '../generated/prisma/client';
import { CustomerScope } from '../identity/customer-scope.types';

export interface AuditWriter {
  append(input: AppendAuditEventInput): Promise<AuditEventRecord>;
}

export interface AppendAuditEventInput {
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
  evidenceRefIds?: string[];
  durationMs?: number;
  metadata?: Prisma.InputJsonValue;
}

export interface AuditEventRecord extends AppendAuditEventInput {
  id: string;
  timestamp: Date;
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
