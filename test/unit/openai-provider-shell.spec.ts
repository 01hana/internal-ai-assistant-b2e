import { ConfigService } from '@nestjs/config';
import { EnvironmentVariables } from '../../src/common/config/env.validation';
import { OpenAiProvider } from '../../src/llm/openai/openai.provider';

describe('OpenAiProvider shell', () => {
  const configService = {
    get: jest.fn((key: keyof EnvironmentVariables) => {
      const values: Partial<EnvironmentVariables> = {
        LLM_PROVIDER: 'openai',
        LLM_MODEL: 'test-selected-model',
        OPENAI_API_KEY: 'placeholder-openai-api-key'
      };

      return values[key];
    })
  } as unknown as ConfigService<EnvironmentVariables, true>;

  it('reports provider and model metadata from config', () => {
    const provider = new OpenAiProvider(configService);

    expect(provider.key).toBe('openai');
    expect(provider.getMetadata({ requestId: 'req-001' })).toEqual({
      provider: 'openai',
      model: 'test-selected-model',
      fallbackUsed: false,
      requestId: 'req-001'
    });
  });

  it('returns deterministic placeholder results without remote model execution', async () => {
    const provider = new OpenAiProvider(configService);

    await expect(
      provider.generateAnswer({
        requestId: 'req-001',
        messages: [{ role: 'user', content: 'How many demo items are available?' }],
        evidence: []
      })
    ).resolves.toMatchObject({
      content: '',
      finishReason: 'not_executed',
      metadata: {
        provider: 'openai',
        model: 'test-selected-model',
        fallbackUsed: false
      }
    });

    await expect(provider.classifyIntent({ requestId: 'req-001', text: 'check order' })).resolves.toMatchObject({
      intent: 'unknown',
      confidence: 0
    });
    await expect(provider.summarize({ requestId: 'req-001', text: 'demo text' })).resolves.toMatchObject({
      summary: ''
    });
  });

  it('keeps OpenAI credentials provider-specific', () => {
    const provider = new OpenAiProvider(configService);

    expect(provider.hasConfiguredApiKey()).toBe(true);
    expect(configService.get).toHaveBeenCalledWith('OPENAI_API_KEY', { infer: true });
  });

  it('stays in the llm/openai layer rather than connectors/openai', () => {
    expect(providerPath()).toContain('src/llm/openai/openai.provider.ts');
    expect(providerPath()).not.toContain('src/connectors/openai');
  });
});

function providerPath() {
  return require.resolve('../../src/llm/openai/openai.provider');
}
