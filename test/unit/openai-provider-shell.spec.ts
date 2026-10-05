import { ConfigService } from '@nestjs/config';
import { EnvironmentVariables } from '../../src/common/config/env.validation';
import { OpenAiProvider, OpenAiResponsesClient } from '../../src/llm/openai/openai.provider';

describe('OpenAiProvider', () => {
  it('maps native Responses text-delta events incrementally and preserves SDK no-retry', async () => {
    const controller = new AbortController();
    const create = jest.fn().mockReturnValue((async function* () {
      yield { type: 'response.output_text.delta', delta: '甲' };
      yield { type: 'response.output_text.delta', delta: '乙' };
      yield { type: 'response.completed', response: { status: 'completed' } };
    })());
    const provider = new OpenAiProvider(createConfigService(), { responses: { create } } as unknown as OpenAiResponsesClient);
    const events: unknown[] = [];
    for await (const event of provider.streamAnswer({ requestId: 'req-native', messages: [], evidence: [], maxOutputTokens: 1024 }, { signal: controller.signal })) events.push(event);
    expect(events).toEqual([
      { type: 'text_delta', text: '甲' }, { type: 'text_delta', text: '乙' },
      { type: 'completed', finishReason: 'stop', metadata: provider.getMetadata({ requestId: 'req-native' }) }
    ]);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ stream: true, max_output_tokens: 1024 }), { maxRetries: 0, signal: controller.signal });
  });

  it('does not retry native streaming after an error following a delta', async () => {
    const create = jest.fn().mockReturnValue((async function* () {
      yield { type: 'response.output_text.delta', delta: 'provisional' };
      throw new Error('raw provider failure');
    })());
    const provider = new OpenAiProvider(createConfigService(), { responses: { create } } as unknown as OpenAiResponsesClient);
    const events: unknown[] = [];
    await expect(async () => {
      for await (const event of provider.streamAnswer({ requestId: 'req-error', messages: [], evidence: [] }, { signal: new AbortController().signal })) events.push(event);
    }).rejects.toThrow('LLM_STREAM_PROVIDER_FAILURE');
    expect(events).toEqual([{ type: 'text_delta', text: 'provisional' }]);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it.each(['response.incomplete', 'response.failed', 'error'])('fails safely on %s without retry or raw diagnostics', async (eventType) => {
    const create = jest.fn().mockReturnValue((async function* () {
      yield { type: eventType, response: { status: 'raw provider detail must stay private' } };
    })());
    const provider = new OpenAiProvider(createConfigService(), { responses: { create } } as unknown as OpenAiResponsesClient);
    let failure: unknown;
    try {
      for await (const _event of provider.streamAnswer({ requestId: 'req-terminal-error', messages: [], evidence: [] }, { signal: new AbortController().signal })) { /* consume */ }
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe('LLM_STREAM_PROVIDER_FAILURE');
    expect((failure as Error).message).not.toContain('raw provider detail');
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('makes one native request on pre-chunk provider failure and on abort', async () => {
    const failedCreate = jest.fn().mockImplementation(() => { throw new Error('raw SDK failure'); });
    const failed = new OpenAiProvider(createConfigService(), { responses: { create: failedCreate } } as unknown as OpenAiResponsesClient);
    await expect(async () => {
      for await (const _event of failed.streamAnswer({ requestId: 'req-before', messages: [], evidence: [] }, { signal: new AbortController().signal })) { /* consume */ }
    }).rejects.toThrow('LLM_STREAM_PROVIDER_FAILURE');
    expect(failedCreate).toHaveBeenCalledTimes(1);
    expect(failedCreate).toHaveBeenCalledWith(expect.objectContaining({ stream: true }), expect.objectContaining({ maxRetries: 0 }));

    const controller = new AbortController();
    const create = jest.fn().mockReturnValue((async function* () {
      controller.abort();
      yield { type: 'response.output_text.delta', delta: 'discarded' };
    })());
    const aborted = new OpenAiProvider(createConfigService(), { responses: { create } } as unknown as OpenAiResponsesClient);
    await expect(async () => {
      for await (const _event of aborted.streamAnswer({ requestId: 'req-aborted', messages: [], evidence: [] }, { signal: controller.signal })) { /* consume */ }
    }).rejects.toThrow('LLM_STREAM_ABORTED');
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][1]).toMatchObject({ maxRetries: 0, signal: controller.signal });
  });
  it('uses the configured model for Responses API answer generation and returns provider metadata', async () => {
    const client = createClientMock({ output_text: '這張訂單目前狀態為已確認。' });
    const provider = new OpenAiProvider(createConfigService(), client);

    await expect(
      provider.generateAnswer({
        requestId: 'req-001',
        messages: [{ role: 'user', content: '訂單狀態？' }],
        evidence: [{ id: 'evidence-001', sourceType: 'tool_result', summary: 'status:已確認' }]
      })
    ).resolves.toEqual({
      content: '這張訂單目前狀態為已確認。',
      finishReason: 'stop',
      metadata: {
        provider: 'openai',
        model: 'test-selected-model',
        fallbackUsed: false,
        requestId: 'req-001'
      }
    });

    expect(client.responses.create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'test-selected-model',
        input: expect.stringContaining('status:已確認'),
        max_output_tokens: 1024
      }),
      { maxRetries: 0 }
    );
  });

  it('returns safe fallback metadata when the SDK call fails without exposing the API key', async () => {
    const client = {
      responses: {
        create: jest.fn().mockRejectedValue(new Error('provider exploded with sk-placeholder-secret-key-1234567890'))
      }
    } satisfies OpenAiResponsesClient;
    const provider = new OpenAiProvider(createConfigService(), client);

    const result = await provider.generateAnswer({
      requestId: 'req-fallback',
      messages: [{ role: 'user', content: 'demo' }],
      evidence: []
    });

    expect(result).toEqual({
      content: '',
      finishReason: 'error',
      metadata: {
        provider: 'openai',
        model: 'test-selected-model',
        fallbackUsed: true,
        fallbackReason: 'provider_error',
        requestId: 'req-fallback'
      }
    });
    expect(JSON.stringify(result)).not.toContain('sk-placeholder-secret-key');
  });

  it('uses Responses API for classify and summarize without hardcoding the model', async () => {
    const client = createClientMock({ output_text: 'order_status_lookup' });
    const provider = new OpenAiProvider(createConfigService(), client);

    await expect(provider.classifyIntent({ requestId: 'req-classify', text: 'check order' })).resolves.toMatchObject({
      intent: 'order_status_lookup',
      confidence: 0.5,
      metadata: {
        model: 'test-selected-model'
      }
    });

    client.responses.create.mockResolvedValueOnce({ output_text: 'short summary' });
    await expect(provider.summarize({ requestId: 'req-summary', text: 'long text' })).resolves.toMatchObject({
      summary: 'short summary',
      metadata: {
        model: 'test-selected-model'
      }
    });
  });

  it('keeps OpenAI credentials provider-specific', () => {
    const configService = createConfigService();
    const provider = new OpenAiProvider(configService, createClientMock({ output_text: '' }));

    expect(provider.hasConfiguredApiKey()).toBe(true);
    expect(configService.get).toHaveBeenCalledWith('OPENAI_API_KEY', { infer: true });
    expect(provider.getMetadata({ requestId: 'req-001' })).not.toHaveProperty('apiKey');
  });

  it('stays in the llm/openai layer rather than connectors/openai', () => {
    expect(providerPath()).toContain('src/llm/openai/openai.provider.ts');
    expect(providerPath()).not.toContain('src/connectors/openai');
  });
});

function createConfigService() {
  return {
    get: jest.fn((key: keyof EnvironmentVariables) => {
      const values: Partial<EnvironmentVariables> = {
        LLM_PROVIDER: 'openai',
        LLM_MODEL: 'test-selected-model',
        OPENAI_API_KEY: 'placeholder-openai-api-key'
      };

      return values[key];
    })
  } as unknown as ConfigService<EnvironmentVariables, true>;
}

function createClientMock(response: { output_text?: string }) {
  return {
    responses: {
      create: jest.fn().mockResolvedValue(response)
    }
  } satisfies OpenAiResponsesClient;
}

function providerPath() {
  return require.resolve('../../src/llm/openai/openai.provider');
}
