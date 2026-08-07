import { AssistantSessionService } from '../../src/assistant/session/assistant-session.service';
import { AssistantSessionStatus, AssistantTaskState } from '../../src/generated/prisma/enums';
import { RequestIdentityContext } from '../../src/identity/identity-context.types';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AuditWriterService } from '../../src/audit/audit-writer.service';
import { AssistantContextStateService } from '../../src/assistant/context/assistant-context-state.service';

describe('AssistantSessionService', () => {
  const identityContext: RequestIdentityContext = {
    requestId: 'req-session-summary',
    actor: {
      actorId: 'actor-001',
      role: 'planner',
      permissionScopes: ['orders:read']
    },
    hostApp: {
      hostApp: 'erp'
    },
    company: {
      organizationId: 'org-001'
    }
  };

  it('writes minimized session_resumed audit after a visible active session summary is restored', async () => {
    const append = jest.fn().mockResolvedValue({ id: 'audit-001' });
    const service = createService({
      session: {
        id: 'session-owned-001',
        organizationId: 'org-001',
        hostApp: 'erp',
        actorId: 'actor-001',
        status: AssistantSessionStatus.active
      },
      contextState: {
        taskState: AssistantTaskState.completed,
        currentTask: 'order_status_lookup',
        currentModule: 'orders',
        currentEntityType: 'order',
        currentEntityId: 'SO-10001'
      },
      append
    });

    const result = await service.getVisibleSessionSummary({
      requestId: 'req-session-summary',
      sessionId: 'session-owned-001',
      identityContext
    });

    expect(result).toEqual(
      expect.objectContaining({
        sessionId: 'session-owned-001',
        status: AssistantSessionStatus.active,
        contextState: expect.objectContaining({
          taskState: AssistantTaskState.completed,
          currentModule: 'orders'
        })
      })
    );
    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'req-session-summary',
        organizationId: 'org-001',
        hostApp: 'erp',
        actorId: 'actor-001',
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
    ['cross-boundary or missing', null],
    ['closed', AssistantSessionStatus.closed],
    ['expired', AssistantSessionStatus.expired]
  ])('does not write session_resumed audit when the session is %s', async (_label, status) => {
    const append = jest.fn();
    const service = createService({
      session: status
        ? {
            id: 'session-owned-001',
            organizationId: 'org-001',
            hostApp: 'erp',
            actorId: 'actor-001',
            status
          }
        : null,
      contextState: null,
      append
    });

    await expect(
      service.getVisibleSessionSummary({
        requestId: 'req-session-summary',
        sessionId: 'session-owned-001',
        identityContext
      })
    ).rejects.toThrow('Assistant session not found');

    expect(append).not.toHaveBeenCalled();
  });
});

function createService(input: {
  session: unknown;
  contextState: unknown;
  append: jest.Mock;
}) {
  return new AssistantSessionService(
    {
      db: {
        assistantSession: {
          findFirst: jest.fn().mockResolvedValue(input.session)
        }
      }
    } as unknown as PrismaService,
    {
      append: input.append
    } as unknown as AuditWriterService,
    {
      loadLatest: jest.fn().mockResolvedValue(input.contextState)
    } as unknown as AssistantContextStateService
  );
}
