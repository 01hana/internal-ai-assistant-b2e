import { Injectable } from '@nestjs/common';
import { AuditWriterService } from '../audit/audit-writer.service';
import { Prisma } from '../generated/prisma/client';
import { RequestIdentityContext } from '../identity/identity-context.types';
import { ToolPermissionDeniedReason } from '../tools/tool-registry.types';

export interface ToolPermissionPrecheckInput {
  requestId: string;
  sessionId: string;
  messageId: string;
  identityContext: RequestIdentityContext;
  toolName: string;
  operation: string;
  requiredPermissionScopes: string[];
}

export interface ToolPermissionPrecheckResult {
  allowed: boolean;
  reason?: ToolPermissionDeniedReason;
  missingScopes?: string[];
}

export interface ToolPermissionDeniedAuditInput {
  requestId: string;
  sessionId: string;
  messageId: string;
  identityContext: RequestIdentityContext;
  toolName: string;
  operation: string;
  deniedReason: ToolPermissionDeniedReason;
  missingScopeCount?: number;
  schemaErrorReason?: string;
}

@Injectable()
export class ToolPermissionPrecheckService {
  constructor(private readonly auditWriter: AuditWriterService) {}

  async check(input: ToolPermissionPrecheckInput): Promise<ToolPermissionPrecheckResult> {
    const actorScopes = new Set(input.identityContext.actor.permissionScopes);
    const missingScopes = input.requiredPermissionScopes.filter((scope) => !actorScopes.has(scope));

    if (missingScopes.length === 0) {
      return { allowed: true };
    }

    await this.recordDenied({
      ...input,
      deniedReason: 'missing_scope',
      missingScopeCount: missingScopes.length
    });

    return {
      allowed: false,
      reason: 'missing_scope',
      missingScopes
    };
  }

  async recordDenied(input: ToolPermissionDeniedAuditInput): Promise<void> {
    const metadata = {
      toolName: input.toolName,
      operation: input.operation,
      deniedReason: input.deniedReason,
      ...(input.missingScopeCount === undefined ? {} : { missingScopeCount: input.missingScopeCount }),
      ...(input.schemaErrorReason === undefined ? {} : { schemaErrorReason: input.schemaErrorReason })
    };

    await this.auditWriter.append({
      requestId: input.requestId,
      organizationId: input.identityContext.company.organizationId,
      hostApp: input.identityContext.hostApp.hostApp,
      actorId: input.identityContext.actor.actorId,
      sessionId: input.sessionId,
      messageId: input.messageId,
      eventType: 'tool_permission_denied',
      metadata: toJsonInput(metadata)
    });
  }
}

function toJsonInput<T>(value: T): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}
