import { NotFoundException } from '@nestjs/common';
import { AssistantHistoryAccessService } from '../../src/assistant/history/assistant-history-access.service';
import { AssistantSessionService } from '../../src/assistant/session/assistant-session.service';
import { AssistantSessionStatus } from '../../src/generated/prisma/enums';

describe('AssistantHistoryAccessService', () => {
  const identityContext = {
    requestId: 'req-history-access',
    customer: { customerId: 'customer-a', integrationId: 'integration-a' },
    actor: { actorId: 'actor-001', roles: ['planner'], permissionScopes: ['orders:read'] },
    hostApp: { hostApp: 'erp' },
    organization: { organizationId: 'org-001' },
    auth: { tokenId: 'token-history-access', gatewayIssuer: 'https://gateway.example.test' }
  };

  it('returns a visible active session without writing denial audit', async () => {
    const getVisibleSession = jest.fn().mockResolvedValue({
      id: 'session-001',
      status: AssistantSessionStatus.active
    });
    const service = new AssistantHistoryAccessService(
      {
        getVisibleSession
      } as unknown as AssistantSessionService
    );

    await expect(
      service.ensureVisibleActiveSession({
        requestId: 'req-history-access',
        sessionId: 'session-001',
        identityContext
      })
    ).resolves.toEqual(expect.objectContaining({ id: 'session-001' }));
    expect(getVisibleSession).toHaveBeenCalledWith(
      'session-001',
      expect.objectContaining({ customerId: 'customer-a', integrationId: 'integration-a' })
    );
  });

  it('fails closed without writing a denial audit when history is not visible', async () => {
    const service = new AssistantHistoryAccessService(
      {
        getVisibleSession: jest.fn().mockRejectedValue(new NotFoundException())
      } as unknown as AssistantSessionService
    );

    await expect(
      service.ensureVisibleActiveSession({
        requestId: 'req-history-denied',
        sessionId: 'session-hidden-001',
        identityContext
      })
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
