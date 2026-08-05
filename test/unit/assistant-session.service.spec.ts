import { AuditWriterService } from '../../src/audit/audit-writer.service';
import { AssistantContextStateService } from '../../src/assistant/context/assistant-context-state.service';
import { AssistantSessionService } from '../../src/assistant/session/assistant-session.service';
import { AssistantSessionStatus, AssistantTaskState } from '../../src/generated/prisma/enums';
import { createCustomerScopeFromIdentityContext } from '../../src/identity/customer-scope.factory';
import { RequestIdentityContext } from '../../src/identity/identity-context.types';
import { PrismaService } from '../../src/prisma/prisma.service';

describe('AssistantSessionService', () => {
  it('creates a session from canonical CustomerScope and preserves initial-context and audit side effects', async () => {
    const harness = createService({
      createdSession: sessionRecord('customer-a', 'session-created-001')
    });

    const result = await harness.service.createSession({
      requestId: 'req-create-session',
      identityContext: identityContextFor('customer-a'),
      pageContext: { module: 'orders' }
    });

    expect(result).toEqual({ sessionId: 'session-created-001', status: AssistantSessionStatus.active });
    expect(harness.prismaMock.assistantSession.create).toHaveBeenCalledWith({
      data: {
        customerId: 'customer-a',
        organizationId: 'org-001',
        hostApp: 'erp',
        actorId: 'actor-001',
        status: AssistantSessionStatus.active
      }
    });
    expect(harness.contextStateMock.createInitialState).toHaveBeenCalledWith({
      customerScope: customerScopeFor('customer-a'),
      sessionId: 'session-created-001',
      pageContext: { module: 'orders' }
    });
    expect(harness.auditMock.append).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'req-create-session',
        organizationId: 'org-001',
        hostApp: 'erp',
        actorId: 'actor-001',
        sessionId: 'session-created-001',
        eventType: 'session_created'
      })
    );
  });

  it('does not create context or audit when session persistence fails', async () => {
    const harness = createService({ createError: new Error('session persistence failed') });

    await expect(
      harness.service.createSession({
        requestId: 'req-create-session-failure',
        identityContext: identityContextFor('customer-a'),
        pageContext: { module: 'orders' }
      })
    ).rejects.toThrow('session persistence failed');

    expect(harness.contextStateMock.createInitialState).not.toHaveBeenCalled();
    expect(harness.auditMock.append).not.toHaveBeenCalled();
  });

  it.each([
    ['Customer A', 'customer-a', 'session-owned-001'],
    ['Customer B', 'customer-b', 'session-hidden-001']
  ])('reads an active %s session with the exact Customer-first predicate', async (_label, customerId, sessionId) => {
    const harness = createService({ session: sessionRecord(customerId, sessionId) });

    const result = await harness.service.getVisibleSession(sessionId, customerScopeFor(customerId));

    expect(result).toMatchObject({ id: sessionId, customerId, status: AssistantSessionStatus.active });
    expect(harness.prismaMock.assistantSession.findFirst).toHaveBeenCalledWith({
      where: visibleSessionPredicate(customerId, sessionId)
    });
  });

  it('returns safe not-found for a missing or foreign session without context or audit work', async () => {
    const harness = createService({ session: null });

    await expect(harness.service.getVisibleSession('session-hidden-001', customerScopeFor('customer-a'))).rejects.toMatchObject({
      status: 404,
      response: { error: 'NOT_FOUND', message: 'Assistant session not found.' }
    });

    expect(harness.prismaMock.assistantSession.findFirst).toHaveBeenCalledWith({
      where: visibleSessionPredicate('customer-a', 'session-hidden-001')
    });
    expect(harness.contextStateMock.loadLatest).not.toHaveBeenCalled();
    expect(harness.auditMock.append).not.toHaveBeenCalled();
  });

  it('loads context only after a visible session and writes minimized session_resumed audit', async () => {
    const harness = createService({
      session: sessionRecord('customer-a', 'session-owned-001'),
      contextState: contextState()
    });

    const result = await harness.service.getVisibleSessionSummary({
      requestId: 'req-session-summary',
      sessionId: 'session-owned-001',
      identityContext: identityContextFor('customer-a')
    });

    expect(result).toEqual(
      expect.objectContaining({
        sessionId: 'session-owned-001',
        status: AssistantSessionStatus.active,
        contextState: expect.objectContaining({ taskState: AssistantTaskState.completed, currentModule: 'orders' })
      })
    );
    expect(harness.prismaMock.assistantSession.findFirst.mock.invocationCallOrder[0]).toBeLessThan(
      harness.contextStateMock.loadLatest.mock.invocationCallOrder[0]
    );
    expect(harness.auditMock.append).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'req-session-summary',
        sessionId: 'session-owned-001',
        eventType: 'session_resumed',
        metadata: {
          hasContextState: true,
          taskState: AssistantTaskState.completed,
          currentModule: 'orders',
          currentEntityType: 'order',
          currentEntityId: 'SO-10001'
        }
      })
    );
  });

  it.each([
    ['missing', null],
    ['closed (filtered by active predicate)', null],
    ['expired (filtered by active predicate)', null]
  ])('does not load context or write session_resumed audit when the session is %s', async (_label, session) => {
    const harness = createService({ session, contextState: null });

    await expect(
      harness.service.getVisibleSessionSummary({
        requestId: 'req-session-summary',
        sessionId: 'session-owned-001',
        identityContext: identityContextFor('customer-a')
      })
    ).rejects.toThrow('Assistant session not found');

    expect(harness.contextStateMock.loadLatest).not.toHaveBeenCalled();
    expect(harness.auditMock.append).not.toHaveBeenCalled();
  });

  it('does not write session_resumed audit when a visible session has no context state', async () => {
    const harness = createService({ session: sessionRecord('customer-a', 'session-owned-001'), contextState: null });

    await expect(
      harness.service.getVisibleSessionSummary({
        requestId: 'req-session-summary-no-context',
        sessionId: 'session-owned-001',
        identityContext: identityContextFor('customer-a')
      })
    ).rejects.toThrow('Assistant session not found');

    expect(harness.contextStateMock.loadLatest).toHaveBeenCalledWith(customerScopeFor('customer-a'), 'session-owned-001');
    expect(harness.auditMock.append).not.toHaveBeenCalled();
  });

  it('lists non-empty active sessions only with the Customer-first predicate', async () => {
    const visibleSessions = [sessionRecord('customer-a', 'session-owned-001')];
    const harness = createService({ sessions: visibleSessions });

    const result = await harness.service.listVisibleSessions(customerScopeFor('customer-a'));

    expect(result).toEqual(visibleSessions);
    expect(result).not.toHaveLength(0);
    expect(result.every((session) => session.customerId === 'customer-a' && session.status === AssistantSessionStatus.active)).toBe(true);
    expect(harness.prismaMock.assistantSession.findMany).toHaveBeenCalledWith({
      where: visibleSessionListPredicate('customer-a')
    });
  });

  it('soft-closes exactly one visible active session without destructive or unrelated side effects', async () => {
    const harness = createService({ updateManyResult: { count: 1 } });

    await expect(
      harness.service.closeVisibleSession({ customerScope: customerScopeFor('customer-a'), sessionId: 'session-owned-001' })
    ).resolves.toEqual({ sessionId: 'session-owned-001', status: AssistantSessionStatus.closed });

    expect(harness.prismaMock.assistantSession.updateMany).toHaveBeenCalledWith({
      where: visibleSessionPredicate('customer-a', 'session-owned-001'),
      data: { status: AssistantSessionStatus.closed }
    });
    expectNoSoftCloseSideEffects(harness);
  });

  it('returns safe not-found when soft-close changes zero rows and does not perform a fallback lookup', async () => {
    const harness = createService({ updateManyResult: { count: 0 } });

    await expect(
      harness.service.closeVisibleSession({ customerScope: customerScopeFor('customer-a'), sessionId: 'session-hidden-001' })
    ).rejects.toMatchObject({
      status: 404,
      response: { error: 'NOT_FOUND', message: 'Assistant session not found.' }
    });

    expect(harness.prismaMock.assistantSession.updateMany).toHaveBeenCalledWith({
      where: visibleSessionPredicate('customer-a', 'session-hidden-001'),
      data: { status: AssistantSessionStatus.closed }
    });
    expect(harness.prismaMock.assistantSession.findFirst).not.toHaveBeenCalled();
    expectNoSoftCloseSideEffects(harness);
  });
});

function createService(input: {
  createdSession?: ReturnType<typeof sessionRecord>;
  createError?: Error;
  session?: ReturnType<typeof sessionRecord> | null;
  sessions?: ReturnType<typeof sessionRecord>[];
  contextState?: ReturnType<typeof contextState> | null;
  updateManyResult?: { count: number };
} = {}) {
  const prismaMock = {
    assistantSession: {
      create: input.createError
        ? jest.fn().mockRejectedValue(input.createError)
        : jest.fn().mockResolvedValue(input.createdSession ?? sessionRecord('customer-a', 'session-created-001')),
      findFirst: jest.fn().mockResolvedValue(input.session ?? null),
      findMany: jest.fn().mockResolvedValue(input.sessions ?? []),
      updateMany: jest.fn().mockResolvedValue(input.updateManyResult ?? { count: 0 }),
      delete: jest.fn(),
      deleteMany: jest.fn()
    }
  };
  const contextStateMock = {
    createInitialState: jest.fn().mockResolvedValue({ id: 'context-created-001' }),
    loadLatest: jest.fn().mockResolvedValue(input.contextState ?? null)
  };
  const auditMock = { append: jest.fn().mockResolvedValue({ id: 'audit-001' }) };

  return {
    service: new AssistantSessionService(
      { db: prismaMock } as unknown as PrismaService,
      auditMock as unknown as AuditWriterService,
      contextStateMock as unknown as AssistantContextStateService
    ),
    prismaMock,
    contextStateMock,
    auditMock
  };
}

function identityContextFor(customerId: string): RequestIdentityContext {
  return {
    requestId: `req-${customerId}`,
    customer: { customerId, integrationId: 'integration-erp' },
    organization: { organizationId: 'org-001' },
    hostApp: { hostApp: 'erp' },
    actor: { actorId: 'actor-001', roles: ['planner'], permissionScopes: ['orders:read'] },
    auth: { tokenId: `token-${customerId}`, gatewayIssuer: 'https://gateway.test.internal' }
  };
}

function customerScopeFor(customerId: string) {
  return createCustomerScopeFromIdentityContext(identityContextFor(customerId));
}

function sessionRecord(customerId: string, id: string, status: AssistantSessionStatus = AssistantSessionStatus.active) {
  return { id, customerId, organizationId: 'org-001', hostApp: 'erp', actorId: 'actor-001', status };
}

function contextState() {
  return {
    taskState: AssistantTaskState.completed,
    currentTask: 'order_status_lookup',
    currentModule: 'orders',
    currentEntityType: 'order',
    currentEntityId: 'SO-10001'
  };
}

function visibleSessionPredicate(customerId: string, id: string) {
  return {
    customerId,
    id,
    organizationId: 'org-001',
    hostApp: 'erp',
    actorId: 'actor-001',
    status: AssistantSessionStatus.active
  };
}

function visibleSessionListPredicate(customerId: string) {
  return {
    customerId,
    organizationId: 'org-001',
    hostApp: 'erp',
    actorId: 'actor-001',
    status: AssistantSessionStatus.active
  };
}

function expectNoSoftCloseSideEffects(harness: ReturnType<typeof createService>) {
  expect(harness.prismaMock.assistantSession.delete).not.toHaveBeenCalled();
  expect(harness.prismaMock.assistantSession.deleteMany).not.toHaveBeenCalled();
  expect(harness.contextStateMock.createInitialState).not.toHaveBeenCalled();
  expect(harness.contextStateMock.loadLatest).not.toHaveBeenCalled();
  expect(harness.auditMock.append).not.toHaveBeenCalled();
}
