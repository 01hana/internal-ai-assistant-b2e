import { LlmExecutionService } from '../../src/llm/llm-execution.service';
import { LlmProvider } from '../../src/llm/llm-provider.interface';
import { LlmObservabilityService } from '../../src/llm/llm-observability.service';
import { LlmProviderService } from '../../src/llm/llm-provider.service';

describe('LlmExecutionService', () => {
  it('records provider metadata after generateAnswer succeeds without leaking prompt, raw response, or API key', async () => {
    const provider = createProvider({
      generateAnswer: jest.fn().mockResolvedValue({
        content: 'raw model answer',
        finishReason: 'stop',
        metadata: {
          provider: 'openai',
          model: 'gpt-5.4-mini',
          fallbackUsed: false,
          requestId: 'req-answer'
        }
      })
    });
    const recordProviderDecision = jest.fn().mockResolvedValue({ id: 'audit-001' });
    const service = createService(provider, recordProviderDecision);

    const result = await service.generateAnswer(
      {
        requestId: 'req-answer',
        messages: [{ role: 'user', content: 'secret prompt with sk-placeholder-api-key-1234567890' }],
        evidence: [{ id: 'evidence-001', sourceType: 'tool_result', summary: 'raw tool output 128000' }]
      },
      executionContext()
    );

    expect(provider.generateAnswer).toHaveBeenCalled();
    expect(result.content).toBe('raw model answer');
    expect(recordProviderDecision).toHaveBeenCalledWith({
      requestId: 'req-answer',
      identityContext: executionContext().identityContext,
      sessionId: undefined,
      messageId: undefined,
      metadata: {
        provider: 'openai',
        model: 'gpt-5.4-mini',
        fallbackUsed: false,
        requestId: 'req-answer'
      }
    });
    expect(JSON.stringify(recordProviderDecision.mock.calls)).not.toContain('secret prompt');
    expect(JSON.stringify(recordProviderDecision.mock.calls)).not.toContain('raw model answer');
    expect(JSON.stringify(recordProviderDecision.mock.calls)).not.toContain('raw tool output');
    expect(JSON.stringify(recordProviderDecision.mock.calls)).not.toContain('sk-placeholder-api-key');
  });

  it('records fallback provider metadata after generateAnswer returns a safe fallback result', async () => {
    const provider = createProvider({
      generateAnswer: jest.fn().mockResolvedValue({
        content: '',
        finishReason: 'error',
        metadata: {
          provider: 'openai',
          model: 'gpt-5.4-mini',
          fallbackUsed: true,
          fallbackReason: 'provider_error',
          requestId: 'req-fallback'
        }
      })
    });
    const recordProviderDecision = jest.fn().mockResolvedValue({ id: 'audit-001' });
    const service = createService(provider, recordProviderDecision);

    const result = await service.generateAnswer(
      {
        requestId: 'req-fallback',
        messages: [{ role: 'user', content: 'demo' }],
        evidence: []
      },
      executionContext()
    );

    expect(result.metadata.fallbackUsed).toBe(true);
    expect(recordProviderDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          fallbackUsed: true,
          fallbackReason: 'provider_error'
        })
      })
    );
  });

  it('records provider metadata for classifyIntent and summarize through the same wrapper', async () => {
    const provider = createProvider({
      classifyIntent: jest.fn().mockResolvedValue({
        intent: 'order_status_lookup',
        confidence: 0.8,
        reasons: ['classified_by_openai_provider'],
        metadata: metadata('req-classify')
      }),
      summarize: jest.fn().mockResolvedValue({
        summary: 'short summary',
        metadata: metadata('req-summary')
      })
    });
    const recordProviderDecision = jest.fn().mockResolvedValue({ id: 'audit-001' });
    const service = createService(provider, recordProviderDecision);

    await service.classifyIntent({ requestId: 'req-classify', text: 'check order' }, executionContext());
    await service.summarize({ requestId: 'req-summary', text: 'long text' }, executionContext());

    expect(provider.classifyIntent).toHaveBeenCalled();
    expect(provider.summarize).toHaveBeenCalled();
    expect(recordProviderDecision).toHaveBeenCalledTimes(2);
    expect(recordProviderDecision).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        requestId: 'req-classify',
        metadata: metadata('req-classify')
      })
    );
    expect(recordProviderDecision).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        requestId: 'req-summary',
        metadata: metadata('req-summary')
      })
    );
  });
});

function createService(provider: LlmProvider, recordProviderDecision: jest.Mock) {
  return new LlmExecutionService(
    {
      getSelectedProvider: jest.fn(() => provider)
    } as unknown as LlmProviderService,
    {
      recordProviderDecision
    } as unknown as LlmObservabilityService
  );
}

function createProvider(overrides: Partial<LlmProvider>): LlmProvider {
  return {
    key: 'openai',
    getMetadata: jest.fn(),
    generateAnswer: jest.fn(),
    classifyIntent: jest.fn(),
    summarize: jest.fn(),
    ...overrides
  } as LlmProvider;
}

function metadata(requestId: string) {
  return {
    provider: 'openai',
    model: 'gpt-5.4-mini',
    fallbackUsed: false,
    requestId
  };
}

function executionContext() {
  return {
    identityContext: {
      requestId: 'req-llm',
      customer: {
        customerId: 'customer-a',
        integrationId: 'integration-erp'
      },
      organization: {
        organizationId: 'org-001'
      },
      actor: {
        actorId: 'actor-001',
        roles: ['planner'],
        permissionScopes: ['orders:read']
      },
      hostApp: {
        hostApp: 'erp'
      },
      auth: {
        tokenId: 'jwt-llm',
        gatewayIssuer: 'https://gateway.test.internal'
      }
    }
  };
}
