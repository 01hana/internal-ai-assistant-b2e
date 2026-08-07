import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { AssistantSessionStatus } from '../../generated/prisma/enums';
import { AuditWriterService } from '../../audit/audit-writer.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AssistantContextStateService } from '../context/assistant-context-state.service';
import { toPageContextAuditMetadata } from '../page-context/page-context.mapper';
import { AssistantSessionSummary, CreateAssistantSessionInput, GetAssistantSessionSummaryInput, PersistedSession } from './assistant-session.types';

@Injectable()
export class AssistantSessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditWriter: AuditWriterService,
    private readonly contextStateService: AssistantContextStateService
  ) {}

  async createSession(input: CreateAssistantSessionInput): Promise<{ sessionId: string; status: AssistantSessionStatus }> {
    const session = await this.prisma.db.assistantSession.create({
      data: {
        hostApp: input.identityContext.hostApp.hostApp,
        organizationId: input.identityContext.company.organizationId,
        actorId: input.identityContext.actor.actorId,
        status: AssistantSessionStatus.active
      }
    });

    await this.contextStateService.createInitialState(session.id, input.pageContext);

    await this.auditWriter.append({
      requestId: input.requestId,
      organizationId: input.identityContext.company.organizationId,
      hostApp: input.identityContext.hostApp.hostApp,
      actorId: input.identityContext.actor.actorId,
      sessionId: session.id,
      eventType: 'session_created',
      metadata: toJsonInput({
        pageContext: toPageContextAuditMetadata(input.pageContext)
      })
    });

    return {
      sessionId: session.id,
      status: session.status
    };
  }

  async getVisibleSessionSummary(input: GetAssistantSessionSummaryInput): Promise<AssistantSessionSummary> {
    const session = await this.getVisibleSession(input.sessionId, input.identityContext);
    const contextState = await this.contextStateService.loadLatest(session.id);

    if (!contextState) {
      throw this.createSessionNotFoundError();
    }

    await this.auditWriter.append({
      requestId: input.requestId,
      organizationId: input.identityContext.company.organizationId,
      hostApp: input.identityContext.hostApp.hostApp,
      actorId: input.identityContext.actor.actorId,
      sessionId: session.id,
      eventType: 'session_resumed',
      metadata: toJsonInput({
        hasContextState: true,
        taskState: contextState.taskState,
        currentModule: contextState.currentModule ?? null,
        currentEntityType: contextState.currentEntityType ?? null,
        currentEntityId: contextState.currentEntityId ?? null
      })
    });

    return {
      sessionId: session.id,
      status: session.status,
      contextState: {
        taskState: contextState.taskState,
        currentTask: contextState.currentTask ?? undefined,
        currentModule: contextState.currentModule ?? undefined,
        currentEntityType: contextState.currentEntityType ?? undefined,
        currentEntityId: contextState.currentEntityId ?? undefined
      }
    };
  }

  async getVisibleSession(sessionId: string, identityContext: CreateAssistantSessionInput['identityContext']): Promise<PersistedSession> {
    const session = await this.prisma.db.assistantSession.findFirst({
      where: {
        id: sessionId,
        organizationId: identityContext.company.organizationId,
        hostApp: identityContext.hostApp.hostApp,
        actorId: identityContext.actor.actorId
      }
    });

    if (!session) {
      throw this.createSessionNotFoundError();
    }

    if (session.status !== AssistantSessionStatus.active) {
      throw this.createSessionNotFoundError();
    }

    return session as PersistedSession;
  }

  createSessionNotFoundError() {
    return new NotFoundException({
      error: 'NOT_FOUND',
      message: 'Assistant session not found.'
    });
  }
}

function toJsonInput<T>(value: T): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}
