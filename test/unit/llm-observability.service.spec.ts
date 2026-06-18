import { AuditWriterService } from '../../src/audit/audit-writer.service';
import { LlmObservabilityService } from '../../src/llm/llm-observability.service';

describe('LlmObservabilityService', () => {
  it('writes selected provider metadata without prompt, raw output, or API key', async () => {
    const append = jest.fn().mockResolvedValue({ id: 'audit-001' });
    const service = new LlmObservabilityService({ append } as unknown as AuditWriterService);

    await service.recordProviderDecision({
      requestId: 'req-llm-selected',
      identityContext: identityContext(),
      metadata: {
        provider: 'openai',
        model: 'gpt-5.4-mini',
        fallbackUsed: false,
        requestId: 'req-llm-selected'
      }
    });

    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'llm_provider_selected',
        metadata: {
          provider: 'openai',
          model: 'gpt-5.4-mini',
          fallbackUsed: false,
          requestId: 'req-llm-selected'
        }
      })
    );
    expect(JSON.stringify(append.mock.calls)).not.toContain('sk-');
    expect(JSON.stringify(append.mock.calls)).not.toContain('prompt');
    expect(JSON.stringify(append.mock.calls)).not.toContain('raw');
  });

  it('writes fallback metadata with safe fallback reason', async () => {
    const append = jest.fn().mockResolvedValue({ id: 'audit-001' });
    const service = new LlmObservabilityService({ append } as unknown as AuditWriterService);

    await service.recordProviderDecision({
      requestId: 'req-llm-fallback',
      identityContext: identityContext(),
      metadata: {
        provider: 'openai',
        model: 'gpt-5.4-mini',
        fallbackUsed: true,
        fallbackReason: 'provider_error',
        requestId: 'req-llm-fallback'
      }
    });

    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'llm_provider_fallback',
        metadata: {
          provider: 'openai',
          model: 'gpt-5.4-mini',
          fallbackUsed: true,
          fallbackReason: 'provider_error',
          requestId: 'req-llm-fallback'
        }
      })
    );
  });
});

function identityContext() {
  return {
    requestId: 'req-llm',
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
}
