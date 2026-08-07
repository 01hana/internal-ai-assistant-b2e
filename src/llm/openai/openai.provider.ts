import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { EnvironmentVariables } from '../../common/config/env.validation';
import {
  ClassifyIntentInput,
  ClassifyIntentResult,
  GenerateAnswerInput,
  GenerateAnswerResult,
  LlmMessage,
  LlmMetadataInput,
  LlmProvider,
  LlmProviderMetadata,
  SummarizeInput,
  SummarizeResult
} from '../llm-provider.interface';

export interface OpenAiResponsesClient {
  responses: {
    create(input: { model: string; input: string; instructions?: string }): Promise<{ output_text?: string }>;
  };
}

@Injectable()
export class OpenAiProvider implements LlmProvider {
  readonly key = 'openai';
  private readonly client: OpenAiResponsesClient;

  constructor(
    private readonly configService: ConfigService<EnvironmentVariables, true>,
    @Optional()
    client?: OpenAiResponsesClient
  ) {
    this.client = client ?? createOpenAiClient(this.configService.get('OPENAI_API_KEY', { infer: true }));
  }

  getMetadata(input: LlmMetadataInput = {}): LlmProviderMetadata {
    return {
      provider: this.key,
      model: this.getModel(),
      fallbackUsed: false,
      requestId: input.requestId
    };
  }

  async generateAnswer(input: GenerateAnswerInput): Promise<GenerateAnswerResult> {
    try {
      const response = await this.client.responses.create({
        model: this.getModel(),
        instructions: input.instructions,
        input: toResponseInput(input.messages, input.evidence)
      });

      return {
        content: response.output_text ?? '',
        finishReason: 'stop',
        metadata: this.getMetadata({ requestId: input.requestId })
      };
    } catch {
      return {
        content: '',
        finishReason: 'error',
        metadata: this.getFallbackMetadata(input.requestId, 'provider_error')
      };
    }
  }

  async classifyIntent(input: ClassifyIntentInput): Promise<ClassifyIntentResult> {
    try {
      const response = await this.client.responses.create({
        model: this.getModel(),
        instructions: 'Classify the user intent. Return only the intent label.',
        input: [
          `Text: ${input.text}`,
          input.candidateIntents?.length ? `Candidate intents: ${input.candidateIntents.join(', ')}` : undefined
        ]
          .filter(Boolean)
          .join('\n')
      });

      return {
        intent: (response.output_text ?? 'unknown').trim() || 'unknown',
        confidence: 0.5,
        reasons: ['classified_by_openai_provider'],
        metadata: this.getMetadata({ requestId: input.requestId })
      };
    } catch {
      return {
        intent: 'unknown',
        confidence: 0,
        reasons: ['provider_error'],
        metadata: this.getFallbackMetadata(input.requestId, 'provider_error')
      };
    }
  }

  async summarize(input: SummarizeInput): Promise<SummarizeResult> {
    try {
      const response = await this.client.responses.create({
        model: this.getModel(),
        instructions: input.maxLength ? `Summarize within ${input.maxLength} characters.` : 'Summarize the text.',
        input: input.text
      });

      return {
        summary: response.output_text ?? '',
        metadata: this.getMetadata({ requestId: input.requestId })
      };
    } catch {
      return {
        summary: '',
        metadata: this.getFallbackMetadata(input.requestId, 'provider_error')
      };
    }
  }

  hasConfiguredApiKey(): boolean {
    return this.configService.get('OPENAI_API_KEY', { infer: true }).trim().length > 0;
  }

  private getModel(): string {
    return this.configService.get('LLM_MODEL', { infer: true });
  }

  private getFallbackMetadata(requestId: string, fallbackReason: string): LlmProviderMetadata {
    return {
      provider: this.key,
      model: this.getModel(),
      fallbackUsed: true,
      fallbackReason,
      requestId
    };
  }
}

function createOpenAiClient(apiKey: string): OpenAiResponsesClient {
  return new OpenAI({ apiKey }) as unknown as OpenAiResponsesClient;
}

function toResponseInput(messages: LlmMessage[], evidence: GenerateAnswerInput['evidence']): string {
  const conversation = messages.map((message) => `${message.role}: ${message.content}`).join('\n');
  const evidenceText = evidence.map((item) => `Evidence ${item.id}: ${item.summary}`).join('\n');

  return [conversation, evidenceText].filter(Boolean).join('\n\n');
}
