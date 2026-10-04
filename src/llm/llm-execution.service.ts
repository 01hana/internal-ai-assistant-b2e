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
import { LlmObservabilityService, RecordGenerationTerminalInput } from './llm-observability.service';
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

  async generateAnswer(input: GenerateAnswerInput, context: LlmExecutionContext, auditMode: 'immediate' | 'terminal' = 'immediate'): Promise<GenerateAnswerResult> {
    const provider = this.providerService.getSelectedProvider();
    let result: GenerateAnswerResult;
    try {
      result = await provider.generateAnswer(input);
    } catch {
      if (auditMode !== 'terminal') throw new Error('LLM_PROVIDER_FAILURE');
      result = { content: '', finishReason: 'error', metadata: provider.getMetadata({ requestId: input.requestId }) };
    }
    if (auditMode === 'immediate') await this.record(input.requestId, context, result.metadata);
    return result;
  }

  recordGroundedGenerationTerminal(input: RecordGenerationTerminalInput) {
    return this.observabilityService.recordGenerationTerminal(input);
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
