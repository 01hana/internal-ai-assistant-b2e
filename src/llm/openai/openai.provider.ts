import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnvironmentVariables } from '../../common/config/env.validation';
import {
  ClassifyIntentInput,
  ClassifyIntentResult,
  GenerateAnswerInput,
  GenerateAnswerResult,
  LlmMetadataInput,
  LlmProvider,
  LlmProviderMetadata,
  SummarizeInput,
  SummarizeResult
} from '../llm-provider.interface';

@Injectable()
export class OpenAiProvider implements LlmProvider {
  readonly key = 'openai';

  constructor(private readonly configService: ConfigService<EnvironmentVariables, true>) {}

  getMetadata(input: LlmMetadataInput = {}): LlmProviderMetadata {
    return {
      provider: this.key,
      model: this.configService.get('LLM_MODEL', { infer: true }),
      fallbackUsed: false,
      requestId: input.requestId
    };
  }

  async generateAnswer(input: GenerateAnswerInput): Promise<GenerateAnswerResult> {
    return {
      content: '',
      finishReason: 'not_executed',
      metadata: this.getMetadata({ requestId: input.requestId })
    };
  }

  async classifyIntent(input: ClassifyIntentInput): Promise<ClassifyIntentResult> {
    return {
      intent: 'unknown',
      confidence: 0,
      reasons: ['OpenAI provider shell does not execute remote model calls yet.'],
      metadata: this.getMetadata({ requestId: input.requestId })
    };
  }

  async summarize(input: SummarizeInput): Promise<SummarizeResult> {
    return {
      summary: '',
      metadata: this.getMetadata({ requestId: input.requestId })
    };
  }

  hasConfiguredApiKey(): boolean {
    return this.configService.get('OPENAI_API_KEY', { infer: true }).trim().length > 0;
  }
}
