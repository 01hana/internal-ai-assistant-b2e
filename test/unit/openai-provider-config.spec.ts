import { ConfigService } from '@nestjs/config';
import { EnvironmentVariables } from '../../src/common/config/env.validation';
import { ConnectorAdapter } from '../../src/connectors/connector-adapter.interface';
import { OpenAiProvider, OpenAiResponsesClient } from '../../src/llm/openai/openai.provider';

describe('US2 OpenAI provider config boundaries', () => {
  it('selects provider and model from LLM_PROVIDER and LLM_MODEL config', () => {
    const configService = createConfigService({
      LLM_PROVIDER: 'openai',
      LLM_MODEL: 'gpt-5.4-mini',
      OPENAI_API_KEY: 'placeholder-openai-api-key'
    });
    const provider = new OpenAiProvider(configService, createClientMock());

    expect(configService.get('LLM_PROVIDER', { infer: true })).toBe('openai');
    expect(provider.getMetadata({ requestId: 'req-us2-openai' })).toEqual({
      provider: 'openai',
      model: 'gpt-5.4-mini',
      fallbackUsed: false,
      requestId: 'req-us2-openai'
    });
  });

  it('stays in src/llm/openai rather than any connectors namespace', () => {
    const resolvedPath = require.resolve('../../src/llm/openai/openai.provider');

    expect(resolvedPath).toContain('src/llm/openai/openai.provider');
    expect(resolvedPath).not.toContain('src/connectors/openai');
  });

  it('is not interchangeable with a connector adapter contract', () => {
    const configService = createConfigService({
      LLM_PROVIDER: 'openai',
      LLM_MODEL: 'gpt-5.4-mini',
      OPENAI_API_KEY: 'placeholder-openai-api-key'
    });
    const provider = new OpenAiProvider(configService, createClientMock());

    expect('execute' in provider).toBe(false);
    expect('listTools' in provider).toBe(false);
    expect(isConnectorAdapter(provider)).toBe(false);
  });
});

function createConfigService(values: Partial<EnvironmentVariables>) {
  return {
    get: jest.fn((key: keyof EnvironmentVariables) => values[key])
  } as unknown as ConfigService<EnvironmentVariables, true>;
}

function createClientMock() {
  return {
    responses: {
      create: jest.fn().mockResolvedValue({ output_text: '' })
    }
  } satisfies OpenAiResponsesClient;
}

function isConnectorAdapter(value: unknown): value is ConnectorAdapter {
  return (
    typeof value === 'object' &&
    value !== null &&
    'execute' in value &&
    typeof (value as { execute?: unknown }).execute === 'function'
  );
}
