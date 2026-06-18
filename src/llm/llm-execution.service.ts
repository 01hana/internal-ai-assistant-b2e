import { Injectable } from '@nestjs/common';
import { RequestIdentityContext } from '../identity/identity-context.types';
import {
  ClassifyIntentInput,
  ClassifyIntentResult,
  GenerateAnswerInput,
  GenerateAnswerResult,
  SummarizeInput,
  SummarizeResult
} from './llm-provider.interface';
import { LlmObservabilityService } from './llm-observability.service';
import { LlmProviderService } from './llm-provider.service';

export interface LlmExecutionContext {
  identityContext: RequestIdentityContext;
  sessionId?: string;
  messageId?: string;
}

@Injectable()
export class LlmExecutionService {
  constructor(
    private readonly providerService: LlmProviderService,
    private readonly observabilityService: LlmObservabilityService
  ) {}

  async generateAnswer(input: GenerateAnswerInput, context: LlmExecutionContext): Promise<GenerateAnswerResult> {
    const provider = this.providerService.getSelectedProvider();
    const result = await provider.generateAnswer(input);
    await this.record(input.requestId, context, result.metadata);
    return result;
  }

  async classifyIntent(input: ClassifyIntentInput, context: LlmExecutionContext): Promise<ClassifyIntentResult> {
    const provider = this.providerService.getSelectedProvider();
    const result = await provider.classifyIntent(input);
    await this.record(input.requestId, context, result.metadata);
    return result;
  }

  async summarize(input: SummarizeInput, context: LlmExecutionContext): Promise<SummarizeResult> {
    const provider = this.providerService.getSelectedProvider();
    const result = await provider.summarize(input);
    await this.record(input.requestId, context, result.metadata);
    return result;
  }

  private async record(
    requestId: string,
    context: LlmExecutionContext,
    metadata: GenerateAnswerResult['metadata']
  ): Promise<void> {
    await this.observabilityService.recordProviderDecision({
      requestId,
      identityContext: context.identityContext,
      sessionId: context.sessionId,
      messageId: context.messageId,
      metadata
    });
  }
}
