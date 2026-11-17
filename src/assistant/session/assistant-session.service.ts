import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { AssistantSessionStatus } from '../../generated/prisma/enums';
import { AuditWriterService } from '../../audit/audit-writer.service';
import { CustomerScope } from '../../identity/customer-scope.types';
import { createCustomerScopeFromIdentityContext } from '../../identity/customer-scope.factory';
import { createCustomerScopeFromHostIntegrationContext } from '../../host-integration/host-integration-request.factory';
import { customerScopedListPredicate, sessionOwnedByScopePredicate } from '../../prisma/customer-scope.predicate';
import { PrismaService } from '../../prisma/prisma.service';
import { AssistantContextStateService } from '../context/assistant-context-state.service';
import { toPageContextAuditMetadata } from '../page-context/page-context.mapper';
import type { AssistantOpeningV1 } from '../../assistant-experience/assistant-experience.service';
import { encodeSessionCursor, SessionCursor } from './session-cursor';
import {
  AssistantSessionListResult,
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

  async createSession(input: CreateAssistantSessionInput): Promise<{ sessionId: string; status: AssistantSessionStatus; opening?: AssistantOpeningV1 }> {
    const customerScope = createCustomerScopeFromHostIntegrationContext(input.hostIntegrationContext);
    if (!customerScope.integrationId?.trim()) throw this.createSessionNotFoundError();
    const session = await this.prisma.db.assistantSession.create({
      data: {
        customerId: customerScope.customerId,
        integrationId: customerScope.integrationId,
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
      customerScope,
      requestId: input.requestId,
      sessionId: session.id,
      eventType: 'session_created',
      metadata: toJsonInput({
        pageContext: toPageContextAuditMetadata(input.pageContext),
        ...(input.opening ? { experienceConfigVersion: input.opening.configVersion,
          quickReplyIds: input.opening.quickReplies.map((item) => item.id) } : {})
      })
    });

    return {
      sessionId: session.id,
      status: session.status,
      ...(input.opening ? { opening: input.opening } : {})
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
      customerScope,
      requestId: input.requestId,
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
    const predicate = { ...sessionOwnedByScopePredicate(customerScope, sessionId), status: AssistantSessionStatus.active };
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
      integrationId: customerScope.integrationId,
      organizationId: customerScope.organizationId,
      hostApp: customerScope.hostApp,
      actorId: customerScope.actorId,
      status: AssistantSessionStatus.active
    });

    return this.prisma.db.assistantSession.findMany({ where: predicate });
  }

  async closeVisibleSession(input: CloseAssistantSessionInput): Promise<CloseAssistantSessionResult> {
    const predicate = { ...sessionOwnedByScopePredicate(input.customerScope, input.sessionId), status: AssistantSessionStatus.active };
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

  /**
   * Feature 013 US4: the actor's own sessions that contain at least one message, newest first —
   * active ones by default, or archived (closed) ones. Deleted sessions are never listed.
   * Sessions opened but never used are excluded so every opening does not add an empty history entry.
   * Listing is not audited (spec US4 scenario 5).
   */
  async listSessionPage(customerScope: CustomerScope,
    input: { limit: number; cursor?: SessionCursor; archived?: boolean }): Promise<AssistantSessionListResult> {
    const predicate = customerScopedListPredicate(customerScope, {
      integrationId: customerScope.integrationId,
      organizationId: customerScope.organizationId,
      hostApp: customerScope.hostApp,
      actorId: customerScope.actorId,
      status: input.archived ? AssistantSessionStatus.closed : AssistantSessionStatus.active
    });
    const rows = await this.prisma.db.assistantSession.findMany({
      where: {
        ...predicate,
        lastMessageAt: { not: null },
        ...(input.cursor ? { OR: [
          { lastMessageAt: { lt: input.cursor.lastMessageAt } },
          { lastMessageAt: input.cursor.lastMessageAt, id: { lt: input.cursor.id } }
        ] } : {})
      },
      orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
      take: input.limit + 1
    });
    const page = rows.slice(0, input.limit);
    const last = page.at(-1);
    return {
      sessions: page.map((row) => ({ sessionId: row.id, title: row.title ?? null, createdAt: row.createdAt.toISOString(),
        lastMessageAt: row.lastMessageAt!.toISOString() })),
      nextCursor: rows.length > input.limit && last?.lastMessageAt
        ? encodeSessionCursor({ lastMessageAt: last.lastMessageAt, id: last.id }) : null
    };
  }

  /** Feature 013 US4: records message activity; the title is set once, from the first user message. */
  async recordUserMessage(customerScope: CustomerScope, sessionId: string, content: string, at: Date = new Date()): Promise<void> {
    const owned = sessionOwnedByScopePredicate(customerScope, sessionId);
    await this.prisma.db.assistantSession.updateMany({ where: { ...owned, title: null },
      data: { title: sessionTitleFrom(content) } });
    await this.prisma.db.assistantSession.updateMany({ where: owned, data: { lastMessageAt: at } });
  }

  /** Feature 013 US4: archives (closes) one of the actor's active sessions and audits it. */
  async archiveVisibleSession(input: { customerScope: CustomerScope; requestId: string; sessionId: string }): Promise<CloseAssistantSessionResult> {
    const result = await this.closeVisibleSession({ customerScope: input.customerScope, sessionId: input.sessionId });
    await this.auditWriter.append({ customerScope: input.customerScope, requestId: input.requestId,
      sessionId: input.sessionId, eventType: 'session_archived' });
    return result;
  }

  /** Feature 013 US4: moves one of the actor's archived sessions back to the active list and audits it. */
  async unarchiveVisibleSession(input: { customerScope: CustomerScope; requestId: string; sessionId: string }) {
    const result = await this.prisma.db.assistantSession.updateMany({
      where: { ...sessionOwnedByScopePredicate(input.customerScope, input.sessionId), status: AssistantSessionStatus.closed },
      data: { status: AssistantSessionStatus.active }
    });
    if (result.count !== 1) throw this.createSessionNotFoundError();
    await this.auditWriter.append({ customerScope: input.customerScope, requestId: input.requestId,
      sessionId: input.sessionId, eventType: 'session_unarchived' });
    return { sessionId: input.sessionId, status: AssistantSessionStatus.active };
  }

  /**
   * Feature 013 US4: hides one of the actor's active or archived sessions for good. The session, its messages
   * and the audit trail are retained (review items and audit events still refer to them); nothing is returned to
   * the user again and the session cannot be restored by the user.
   */
  async deleteVisibleSession(input: { customerScope: CustomerScope; requestId: string; sessionId: string }) {
    const result = await this.prisma.db.assistantSession.updateMany({
      where: { ...sessionOwnedByScopePredicate(input.customerScope, input.sessionId),
        status: { in: [AssistantSessionStatus.active, AssistantSessionStatus.closed] } },
      data: { status: AssistantSessionStatus.deleted }
    });
    if (result.count !== 1) throw this.createSessionNotFoundError();
    await this.auditWriter.append({ customerScope: input.customerScope, requestId: input.requestId,
      sessionId: input.sessionId, eventType: 'session_deleted' });
    return { sessionId: input.sessionId, status: AssistantSessionStatus.deleted };
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

export const SESSION_TITLE_MAX_LENGTH = 40;

/** Whitespace-collapsed, trimmed, at most 40 characters (code points). No LLM is involved. */
export function sessionTitleFrom(content: string): string {
  return [...content.replace(/\s+/gu, ' ').trim()].slice(0, SESSION_TITLE_MAX_LENGTH).join('');
}
