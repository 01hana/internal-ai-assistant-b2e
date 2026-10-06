import { NotFoundException } from '@nestjs/common';
import { AssistantHistoryAccessService } from '../../src/assistant/history/assistant-history-access.service';
import { AssistantSessionService } from '../../src/assistant/session/assistant-session.service';
import { AssistantSessionStatus } from '../../src/generated/prisma/enums';

describe('AssistantHistoryAccessService', () => {
  it('does not authorize a pending or decision-less Assistant message as completed history', () => {
    const service = new AssistantHistoryAccessService({} as AssistantSessionService);
    const completed = { role: 'assistant', content: 'verified final', answerDecision: 'answered',
      answerDecisions: [{ id: 'decision-1', status: 'answered', groundingCheckId: 'grounding-1' }] };
    expect(service.isCompletedHistoryMessage(completed)).toBe(true);
    expect(service.isCompletedHistoryMessage({ ...completed, content: '目前沒有足夠的核准資料。', answerDecision: 'no_answer',
      answerDecisions: [{ id: 'decision-safe', status: 'no_answer', groundingCheckId: 'grounding-safe' }] })).toBe(true);
    for (const message of [
      { ...completed, content: 'Pending answer.' },
      { ...completed, content: '   ' },
      { ...completed, answerDecisions: [] },
      { ...completed, answerDecisions: [{ id: 'decision-1', status: 'answered', groundingCheckId: null }] },
      { ...completed, answerDecision: 'no_answer' },
      { ...completed, answerDecisions: [{ id: 'decision-1', status: 'tool_failed', groundingCheckId: 'grounding-1' }] },
      { ...completed, answerDecision: 'tool_failed', answerDecisions: [{ id: 'decision-1', status: 'tool_failed', groundingCheckId: 'grounding-1' }] }
    ]) expect(service.isCompletedHistoryMessage(message)).toBe(false);
  });
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
