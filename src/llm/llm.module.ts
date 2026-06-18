import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { OpenAiModule } from './openai/openai.module';
import { OpenAiProvider } from './openai/openai.provider';
import { LlmExecutionService } from './llm-execution.service';
import { LlmObservabilityService } from './llm-observability.service';
import { LlmProviderService } from './llm-provider.service';
import { LLM_PROVIDERS, SELECTED_LLM_PROVIDER } from './llm-provider.tokens';

@Module({
  imports: [AuditModule, OpenAiModule],
  providers: [
    {
      provide: LLM_PROVIDERS,
      useFactory: (openAiProvider: OpenAiProvider) => [openAiProvider],
      inject: [OpenAiProvider]
    },
    LlmProviderService,
    {
      provide: SELECTED_LLM_PROVIDER,
      useFactory: (registry: LlmProviderService) => registry.getSelectedProvider(),
      inject: [LlmProviderService]
    },
    LlmExecutionService,
    LlmObservabilityService
  ],
  // Feature modules should use LlmExecutionService as the public LLM entrypoint.
  // Direct provider access stays internal so provider/model/fallback observability cannot be bypassed.
  exports: [LlmExecutionService]
})
export class LlmModule {}
