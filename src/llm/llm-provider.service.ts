import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnvironmentVariables } from '../common/config/env.validation';
import { LlmProvider } from './llm-provider.interface';
import { LLM_PROVIDERS, LlmProviderCollection } from './llm-provider.tokens';

@Injectable()
export class LlmProviderService {
  constructor(
    private readonly configService: ConfigService<EnvironmentVariables, true>,
    @Inject(LLM_PROVIDERS) private readonly providers: LlmProviderCollection
  ) {}

  getSelectedProvider(): LlmProvider {
    const selectedProvider = this.configService.get('LLM_PROVIDER', { infer: true });
    const provider = this.providers.find((candidate) => candidate.key === selectedProvider);

    if (!provider) {
      throw new Error(`Unsupported LLM provider configured: ${selectedProvider}`);
    }

    return provider;
  }
}
