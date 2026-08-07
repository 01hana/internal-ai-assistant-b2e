import { NotFoundException } from '@nestjs/common';
import { AuditWriterService } from '../../src/audit/audit-writer.service';
import { AssistantHistoryAccessService } from '../../src/assistant/history/assistant-history-access.service';
import { AssistantSessionService } from '../../src/assistant/session/assistant-session.service';
import { AssistantSessionStatus } from '../../src/generated/prisma/enums';

describe('AssistantHistoryAccessService', () => {
  const identityContext = {
    requestId: 'req-history-access',
    actor: { actorId: 'actor-001', role: 'planner', permissionScopes: ['orders:read'] },
    hostApp: { hostApp: 'erp' },
    company: { organizationId: 'org-001' }
  };

  it('returns a visible active session without writing denial audit', async () => {
    const append = jest.fn();
    const service = new AssistantHistoryAccessService(
      {
        getVisibleSession: jest.fn().mockResolvedValue({
          id: 'session-001',
          status: AssistantSessionStatus.active
        })
      } as unknown as AssistantSessionService,
      { append } as unknown as AuditWriterService
    );

    await expect(
      service.ensureVisibleActiveSession({
        requestId: 'req-history-access',
        sessionId: 'session-001',
        identityContext
      })
    ).resolves.toEqual(expect.objectContaining({ id: 'session-001' }));
    expect(append).not.toHaveBeenCalled();
  });

  it('fails closed and writes minimized denial audit when history is not visible', async () => {
    const append = jest.fn().mockResolvedValue({ id: 'audit-denied' });
    const service = new AssistantHistoryAccessService(
      {
        getVisibleSession: jest.fn().mockRejectedValue(new NotFoundException())
      } as unknown as AssistantSessionService,
      { append } as unknown as AuditWriterService
    );

    await expect(
      service.ensureVisibleActiveSession({
        requestId: 'req-history-denied',
        sessionId: 'session-hidden-001',
        identityContext
      })
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'req-history-denied',
        eventType: 'session_history_denied',
        metadata: {
          requestedSessionId: 'session-hidden-001',
          operation: 'history_read',
          permissionDeniedReason: 'session_not_visible_or_inactive'
        }
      })
    );
    expect(append.mock.calls[0][0]).not.toHaveProperty('sessionId');
    expect(JSON.stringify(append.mock.calls[0][0])).not.toContain('這張訂單目前狀態');
    expect(JSON.stringify(append.mock.calls[0][0])).not.toContain('outputSummary');
  });
});
