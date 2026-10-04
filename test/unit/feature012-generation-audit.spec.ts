import { AuditWriterService } from '../../src/audit/audit-writer.service';
import { StructuredLoggerService } from '../../src/common/logger/structured-logger.service';
import { LlmObservabilityService } from '../../src/llm/llm-observability.service';

const identityContext = {
  requestId: 'req-f012-audit', customer: { customerId: 'customer-a', integrationId: 'integration-erp' },
  organization: { organizationId: 'org-a' }, hostApp: { hostApp: 'erp' },
  actor: { actorId: 'actor-a', roles: [], permissionScopes: [] },
  auth: { tokenId: 'private', gatewayIssuer: 'https://gateway.test.internal' }
};

describe('Feature 012 terminal generation audit', () => {
  it('uses the existing append writer once and stores no prompt or answer', async () => {
    const append = jest.fn().mockResolvedValue({ id: 'audit-1' });
    const service = new LlmObservabilityService({ append } as unknown as AuditWriterService);
    const result = await service.recordGenerationTerminal({
      requestId: 'req-f012-audit', sessionId: 'session-a', messageId: 'message-a', identityContext,
      metadata: { provider: 'openai', model: 'test-model', fallbackUsed: false }, outcome: 'COMPLETED', durationMs: 12
    });
    expect(result).toEqual({ auditPersisted: true });
    expect(append).toHaveBeenCalledTimes(1);
    expect(append.mock.calls[0][0].eventType).toBe('llm_generation_completed');
    expect(JSON.stringify(append.mock.calls)).not.toContain('private');
    expect(JSON.stringify(append.mock.calls)).not.toContain('prompt');
  });

  it.each(['throw', 'hang'])('bounds %s and reports AUDIT_PERSISTED=NO without a second append', async (mode) => {
    jest.useFakeTimers();
    const warn = jest.spyOn(StructuredLoggerService.prototype, 'warn').mockImplementation(() => undefined);
    const append = mode === 'throw' ? jest.fn().mockRejectedValue(new Error('secret provider body')) :
      jest.fn().mockImplementation(() => new Promise(() => undefined));
    const service = new LlmObservabilityService({ append } as unknown as AuditWriterService);
    const completion = service.recordGenerationTerminal({
      requestId: 'req-f012-audit', sessionId: 'session-a', messageId: 'message-a', identityContext,
      metadata: { provider: 'openai', model: 'test-model', fallbackUsed: false }, outcome: 'COMPLETED', durationMs: 12
    });
    await jest.advanceTimersByTimeAsync(2001);
    expect(await completion).toEqual({ auditPersisted: false });
    expect(append).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('FEATURE012_AUDIT_PERSISTENCE_FAILED', 'LlmObservabilityService',
      expect.objectContaining({ AUDIT_PERSISTED: 'NO', eventType: 'llm_generation_terminal',
        requestId: 'req-f012-audit', sessionId: 'session-a', messageId: 'message-a' }));
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/private|secret provider body|prompt|generated answer/);
    warn.mockRestore();
    jest.useRealTimers();
  });

  it.each([
    ['FAILED', 'PROVIDER_ERROR'],
    ['CANCELLED', 'CANCELLED']
  ] as const)('attempts exactly one safe terminal append for %s generation', async (outcome, reasonCode) => {
    const append = jest.fn().mockResolvedValue({ id: 'audit-terminal' });
    const service = new LlmObservabilityService({ append } as unknown as AuditWriterService);
    const result = await service.recordGenerationTerminal({
      requestId: 'req-f012-audit', sessionId: 'session-a', messageId: 'message-a', identityContext,
      metadata: { provider: 'openai', model: 'test-model', fallbackUsed: false },
      outcome, reasonCode, durationMs: 17
    });
    expect(result).toEqual({ auditPersisted: true });
    expect(append).toHaveBeenCalledTimes(1);
    expect(append).toHaveBeenCalledWith(expect.objectContaining({
      requestId: 'req-f012-audit', sessionId: 'session-a', messageId: 'message-a',
      eventType: 'llm_generation_terminated', durationMs: 17,
      metadata: { provider: 'openai', model: 'test-model', fallbackUsed: false, outcome, reasonCode }
    }));
    const serialized = JSON.stringify(append.mock.calls);
    expect(serialized).not.toMatch(/private|prompt|generated answer|rawResponse|credential|connectorContextRef|toolResult/);
  });
});
