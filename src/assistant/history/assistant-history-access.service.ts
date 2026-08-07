import { Injectable } from '@nestjs/common';
import { AuditWriterService } from '../../audit/audit-writer.service';
import { Prisma } from '../../generated/prisma/client';
import { RequestIdentityContext } from '../../identity/identity-context.types';
import { AssistantSessionService } from '../session/assistant-session.service';
import { PersistedSession } from '../session/assistant-session.types';

export interface EnsureHistoryAccessInput {
  requestId: string;
  sessionId: string;
  identityContext: RequestIdentityContext;
}

@Injectable()
export class AssistantHistoryAccessService {
  constructor(
    private readonly sessionService: AssistantSessionService,
    private readonly auditWriter: AuditWriterService
  ) {}

  async ensureVisibleActiveSession(input: EnsureHistoryAccessInput): Promise<PersistedSession> {
    try {
      return await this.sessionService.getVisibleSession(input.sessionId, input.identityContext);
    } catch (error) {
      await this.auditWriter.append({
        requestId: input.requestId,
        organizationId: input.identityContext.company.organizationId,
        hostApp: input.identityContext.hostApp.hostApp,
        actorId: input.identityContext.actor.actorId,
        eventType: 'session_history_denied',
        metadata: toJsonInput({
          requestedSessionId: input.sessionId,
          operation: 'history_read',
          permissionDeniedReason: 'session_not_visible_or_inactive'
        })
      });

      throw error;
    }
  }
}

function toJsonInput<T>(value: T): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}
