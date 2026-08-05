import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { AssistantSessionStatus } from '../../generated/prisma/enums';
import { AuditWriterService } from '../../audit/audit-writer.service';
import { CustomerScope } from '../../identity/customer-scope.types';
import { createCustomerScopeFromIdentityContext } from '../../identity/customer-scope.factory';
import { customerScopedIdPredicate, customerScopedListPredicate } from '../../prisma/customer-scope.predicate';
import { PrismaService } from '../../prisma/prisma.service';
import { AssistantContextStateService } from '../context/assistant-context-state.service';
import { toPageContextAuditMetadata } from '../page-context/page-context.mapper';
import {
  AssistantSessionSummary,
  CloseAssistantSessionInput,
  CloseAssistantSessionResult,
  CreateAssistantSessionInput,
  GetAssistantSessionSummaryInput,
  PersistedSession,
  VisibleAssistantSession
} from './assistant-session.types';

@Injectable()
export class AssistantSessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditWriter: AuditWriterService,
    private readonly contextStateService: AssistantContextStateService
  ) {}

  async createSession(input: CreateAssistantSessionInput): Promise<{ sessionId: string; status: AssistantSessionStatus }> {
    const customerScope = createCustomerScopeFromIdentityContext(input.identityContext);
    const session = await this.prisma.db.assistantSession.create({
      data: {
        customerId: customerScope.customerId,
        hostApp: customerScope.hostApp,
        organizationId: customerScope.organizationId,
        actorId: customerScope.actorId,
        status: AssistantSessionStatus.active
      }
    });

    await this.contextStateService.createInitialState({
      customerScope,
      sessionId: session.id,
      pageContext: input.pageContext
    });

    await this.auditWriter.append({
      requestId: input.requestId,
      organizationId: input.identityContext.organization.organizationId,
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
    const customerScope = createCustomerScopeFromIdentityContext(input.identityContext);
    const session = await this.getVisibleSession(input.sessionId, customerScope);
    const contextState = await this.contextStateService.loadLatest(customerScope, session.id);

    if (!contextState) {
      throw this.createSessionNotFoundError();
    }

    await this.auditWriter.append({
      requestId: input.requestId,
      organizationId: input.identityContext.organization.organizationId,
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

  async getVisibleSession(sessionId: string, customerScope: CustomerScope): Promise<PersistedSession> {
    const predicate = customerScopedIdPredicate(customerScope, {
      id: sessionId,
      organizationId: customerScope.organizationId,
      hostApp: customerScope.hostApp,
      actorId: customerScope.actorId,
      status: AssistantSessionStatus.active
    });
    const session = await this.prisma.db.assistantSession.findFirst({
      where: predicate
    });

    if (!session) {
      throw this.createSessionNotFoundError();
    }

    return session;
  }

  async listVisibleSessions(customerScope: CustomerScope): Promise<VisibleAssistantSession[]> {
    const predicate = customerScopedListPredicate(customerScope, {
      organizationId: customerScope.organizationId,
      hostApp: customerScope.hostApp,
      actorId: customerScope.actorId,
      status: AssistantSessionStatus.active
    });

    return this.prisma.db.assistantSession.findMany({ where: predicate });
  }

  async closeVisibleSession(input: CloseAssistantSessionInput): Promise<CloseAssistantSessionResult> {
    const predicate = customerScopedIdPredicate(input.customerScope, {
      id: input.sessionId,
      organizationId: input.customerScope.organizationId,
      hostApp: input.customerScope.hostApp,
      actorId: input.customerScope.actorId,
      status: AssistantSessionStatus.active
    });
    const result = await this.prisma.db.assistantSession.updateMany({
      where: predicate,
      data: { status: AssistantSessionStatus.closed }
    });

    if (result.count !== 1) {
      throw this.createSessionNotFoundError();
    }

    return {
      sessionId: input.sessionId,
      status: AssistantSessionStatus.closed
    };
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
