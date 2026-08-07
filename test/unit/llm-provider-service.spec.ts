import { ConfigService } from '@nestjs/config';
import { EnvironmentVariables } from '../../src/common/config/env.validation';
import { LlmProvider } from '../../src/llm/llm-provider.interface';
import { LlmProviderService } from '../../src/llm/llm-provider.service';

describe('LlmProviderService', () => {
  it('selects OpenAiProvider when LLM_PROVIDER=openai', () => {
    const openAiProvider = {
      key: 'openai',
      getMetadata: jest.fn()
    } as unknown as LlmProvider;
    const service = new LlmProviderService(createConfigService({ LLM_PROVIDER: 'openai' }), [openAiProvider]);

    expect(service.getSelectedProvider()).toBe(openAiProvider);
  });

  it('fails closed when configured provider has no matching provider instance', () => {
    const openAiProvider = {
      key: 'openai',
      getMetadata: jest.fn()
    } as unknown as LlmProvider;
    const service = new LlmProviderService(createConfigService({ LLM_PROVIDER: 'unsupported' as never }), [
      openAiProvider
    ]);

    expect(() => service.getSelectedProvider()).toThrow('Unsupported LLM provider configured: unsupported');
  });
});

function createConfigService(values: Partial<EnvironmentVariables>) {
  return {
    get: jest.fn((key: keyof EnvironmentVariables) => values[key])
  } as unknown as ConfigService<EnvironmentVariables, true>;
}
