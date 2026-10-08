import { LlmExecutionService } from '../../src/llm/llm-execution.service';
import { LlmProvider } from '../../src/llm/llm-provider.interface';
import { LlmObservabilityService } from '../../src/llm/llm-observability.service';
import { LlmProviderService } from '../../src/llm/llm-provider.service';
import { spawnSync } from 'node:child_process';

describe('LlmExecutionService', () => {
  it('keeps a strict Node process alive through SDK-shaped stream failures and aborts', () => {
    const result = spawnSync(process.execPath, [
      '--unhandled-rejections=strict', '-r', 'ts-node/register/transpile-only',
      require.resolve('../support/openai-stream-crash-probe.cjs')
    ], { cwd: process.cwd(), encoding: 'utf8', timeout: 10000,
      env: { ...process.env, OPENAI_API_KEY: '', TS_NODE_COMPILER_OPTIONS: '{"rootDir":"."}' } });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('PROCESS_SAFE');
  });

  it('streams typed provisional text and one terminal event through the selected provider', async () => {
    const controller = new AbortController();
    let providerSignal: AbortSignal | undefined;
    const streamAnswer = jest.fn(async function* (_input: unknown, options: { signal: AbortSignal }) {
      providerSignal = options.signal;
      yield { type: 'text_delta' as const, text: '甲' };
      yield { type: 'text_delta' as const, text: '乙' };
      yield { type: 'completed' as const, finishReason: 'stop' as const, metadata: metadata('req-stream') };
    });
    const provider = createProvider({ streamAnswer });
    const service = createService(provider, jest.fn());
    const events = [];
    for await (const event of service.streamAnswer({ requestId: 'req-stream', messages: [], evidence: [], maxOutputTokens: 1024 }, executionContext(), { signal: controller.signal, deadlineMs: 1000 })) events.push(event);
    expect(events).toEqual([
      { type: 'text_delta', text: '甲' }, { type: 'text_delta', text: '乙' },
      { type: 'completed', finishReason: 'stop', metadata: metadata('req-stream') }
    ]);
    expect(streamAnswer).toHaveBeenCalledTimes(1);
    expect(streamAnswer).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'req-stream' }), expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(controller.signal.aborted).toBe(false);
    expect(providerSignal?.aborted).toBe(false);
  });

  it.each(['caller abort', 'deadline'] as const)('closes a pending provider iterator after %s', async (scenario) => {
    const caller = new AbortController();
    let notifyStarted!: () => void;
    const started = new Promise<void>((resolve) => { notifyStarted = resolve; });
    const close = jest.fn().mockResolvedValue({ done: true, value: undefined });
    const provider = createProvider({ streamAnswer: jest.fn((_input, options) => ({
      [Symbol.asyncIterator]: () => ({
        next: () => new Promise<IteratorResult<unknown>>((_resolve, reject) => {
          options.signal.addEventListener('abort', () => reject(new Error('APIUserAbortError')), { once: true });
          notifyStarted();
        }),
        return: close
      })
    })) as LlmProvider['streamAnswer'] });
    const service = createService(provider, jest.fn());
    const consume = async () => {
      for await (const _event of service.streamAnswer({ requestId: 'req-pending', messages: [], evidence: [] },
        executionContext(), { signal: caller.signal, deadlineMs: scenario === 'deadline' ? 5 : 1000 })) { /* consume */ }
    };
    const result = consume();
    await started;
    if (scenario === 'caller abort') caller.abort();
    await expect(result).rejects.toThrow(scenario === 'deadline' ? 'LLM_STREAM_DEADLINE' : 'LLM_STREAM_ABORTED');
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('bounds iterator cleanup when return never settles', async () => {
    const close = jest.fn(() => new Promise<IteratorResult<unknown>>(() => undefined));
    const provider = createProvider({ streamAnswer: jest.fn(() => ({
      [Symbol.asyncIterator]: () => ({
        next: jest.fn().mockResolvedValue({ done: false, value: { type: 'text_delta', text: '' } }),
        return: close
      })
    })) as LlmProvider['streamAnswer'] });
    const service = createService(provider, jest.fn());
    const started = Date.now();
    await expect(async () => {
      for await (const _event of service.streamAnswer({ requestId: 'req-stalled-cleanup', messages: [], evidence: [] },
        executionContext(), { signal: new AbortController().signal })) { /* consume */ }
    }).rejects.toThrow('LLM_STREAM_INVALID_EVENT');
    expect(close).toHaveBeenCalledTimes(1);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('rejects over-budget input before provider selection and caps requested output tokens', async () => {
    const streamAnswer = jest.fn(async function* () {
      yield { type: 'completed' as const, finishReason: 'stop' as const, metadata: metadata('req-capped') };
    });
    const service = createService(createProvider({ streamAnswer }), jest.fn());
    await expect(async () => {
      for await (const _event of service.streamAnswer({ requestId: 'req-oversized-input',
        messages: [{ role: 'user', content: 'x'.repeat(16 * 1024) }], evidence: [] },
      executionContext(), { signal: new AbortController().signal })) { /* consume */ }
    }).rejects.toThrow('LLM_STREAM_INPUT_LIMIT');
    expect(streamAnswer).not.toHaveBeenCalled();

    for await (const _event of service.streamAnswer({ requestId: 'req-capped', messages: [], evidence: [], maxOutputTokens: 2048 },
      executionContext(), { signal: new AbortController().signal })) { /* consume */ }
    expect(streamAnswer).toHaveBeenCalledWith(expect.objectContaining({ maxOutputTokens: 1024 }), expect.any(Object));
  });

  it('rejects malformed terminal metadata without releasing its provider diagnostic', async () => {
    const service = createService(createProvider({ streamAnswer: async function* () {
      yield { type: 'completed', finishReason: 'stop', metadata: {
        provider: 'openai', model: 'test-model', fallbackUsed: false, fallbackReason: 42
      } } as never;
    } }), jest.fn());
    await expect(async () => {
      for await (const _event of service.streamAnswer({ requestId: 'req-malformed-metadata', messages: [], evidence: [] },
        executionContext(), { signal: new AbortController().signal })) { /* consume */ }
    }).rejects.toThrow('LLM_STREAM_INVALID_EVENT');
  });

  it('aborts and rejects a stream that exceeds the server output bound', async () => {
    const upstreamAbort = jest.fn();
    const provider = createProvider({ streamAnswer: async function* (_input, options) {
      options.signal.addEventListener('abort', upstreamAbort);
      yield { type: 'text_delta', text: 'x'.repeat(4097) };
    } });
    const service = createService(provider, jest.fn());
    await expect(async () => {
      for await (const _event of service.streamAnswer({ requestId: 'req-stream-limit', messages: [], evidence: [] }, executionContext(), { signal: new AbortController().signal })) { /* consume */ }
    }).rejects.toThrow('LLM_STREAM_OUTPUT_LIMIT');
    expect(upstreamAbort).toHaveBeenCalledTimes(1);
  });

  it('enforces a server deadline while a provider is stalled before its first chunk', async () => {
    let providerSignal: AbortSignal | undefined;
    const provider = createProvider({ streamAnswer: async function* (_input, options) {
      providerSignal = options.signal;
      await new Promise<void>(() => undefined);
      yield { type: 'text_delta', text: 'unreachable' };
    } });
    const service = createService(provider, jest.fn());
    await expect(async () => {
      for await (const _event of service.streamAnswer({ requestId: 'req-deadline', messages: [], evidence: [] }, executionContext(), { signal: new AbortController().signal, deadlineMs: 5 })) { /* consume */ }
    }).rejects.toThrow('LLM_STREAM_DEADLINE');
    expect(providerSignal?.aborted).toBe(true);
  });

  it('propagates caller abort and rejects malformed provider chunks safely', async () => {
    const caller = new AbortController();
    let providerSignal: AbortSignal | undefined;
    const provider = createProvider({ streamAnswer: async function* (_input, options) {
      providerSignal = options.signal;
      caller.abort();
      await new Promise<void>(() => undefined);
      yield { type: 'text_delta', text: 'unreachable' };
    } });
    const service = createService(provider, jest.fn());
    await expect(async () => {
      for await (const _event of service.streamAnswer({ requestId: 'req-abort', messages: [], evidence: [] }, executionContext(), { signal: caller.signal })) { /* consume */ }
    }).rejects.toThrow('LLM_STREAM_ABORTED');
    expect(providerSignal?.aborted).toBe(true);

    const malformed = createService(createProvider({ streamAnswer: async function* () {
      yield { type: 'text_delta', text: '' };
    } }), jest.fn());
    await expect(async () => {
      for await (const _event of malformed.streamAnswer({ requestId: 'req-invalid', messages: [], evidence: [] }, executionContext(), { signal: new AbortController().signal })) { /* consume */ }
    }).rejects.toThrow('LLM_STREAM_INVALID_EVENT');
  });
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
