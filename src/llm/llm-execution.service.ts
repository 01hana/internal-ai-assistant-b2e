import { Injectable } from '@nestjs/common';
import { RequestIdentityContext } from '../identity/identity-context.types';
import {
  ClassifyIntentInput,
  ClassifyIntentResult,
  GenerateAnswerInput,
  GenerateAnswerResult,
  LlmStreamEvent,
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

export interface LlmExecutionStreamOptions {
  readonly signal: AbortSignal;
  readonly deadlineMs?: number;
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

  async *streamAnswer(input: GenerateAnswerInput, _context: LlmExecutionContext, options: LlmExecutionStreamOptions): AsyncIterable<LlmStreamEvent> {
    const provider = this.providerService.getSelectedProvider();
    const inputBytes = Buffer.byteLength(JSON.stringify({
      instructions: input.instructions ?? '', messages: input.messages, evidence: input.evidence
    }), 'utf8');
    if (inputBytes > 16 * 1024) throw new Error('LLM_STREAM_INPUT_LIMIT');
    const controller = new AbortController();
    let abortReason = 'LLM_STREAM_ABORTED';
    let rejectAbort!: (reason: Error) => void;
    const abortWait = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
    void abortWait.catch(() => undefined);
    const abort = (reason: string) => {
      if (controller.signal.aborted) return;
      abortReason = reason;
      controller.abort();
      rejectAbort(new Error(reason));
    };
    const onExternalAbort = () => abort('LLM_STREAM_ABORTED');
    options.signal.addEventListener('abort', onExternalAbort, { once: true });
    const deadline = Math.min(Math.max(options.deadlineMs ?? 30_000, 1), 30_000);
    const timer = setTimeout(() => abort('LLM_STREAM_DEADLINE'), deadline);
    let outputBytes = 0;
    let completed = false;
    try {
      if (options.signal.aborted) abort('LLM_STREAM_ABORTED');
      if (controller.signal.aborted) throw new Error(abortReason);
      const stream = provider.streamAnswer({ ...input, maxOutputTokens: Math.min(input.maxOutputTokens ?? 1024, 1024) }, { signal: controller.signal });
      const iterator = stream[Symbol.asyncIterator]();
      while (true) {
        const next = await Promise.race([iterator.next(), abortWait]);
        if (next.done) break;
        const event = next.value as LlmStreamEvent;
        if (event?.type === 'text_delta' && typeof event.text === 'string' && event.text.length > 0 && !completed) {
          outputBytes += Buffer.byteLength(event.text, 'utf8');
          if (outputBytes > 4096) { abort('LLM_STREAM_OUTPUT_LIMIT'); throw new Error('LLM_STREAM_OUTPUT_LIMIT'); }
          yield Object.freeze({ type: 'text_delta', text: event.text });
        } else if (event?.type === 'completed' && !completed && event.finishReason === 'stop' && isSafeMetadata(event.metadata)) {
          completed = true;
          yield Object.freeze({ type: 'completed', finishReason: 'stop', metadata: event.metadata });
        } else {
          abort('LLM_STREAM_INVALID_EVENT');
          throw new Error('LLM_STREAM_INVALID_EVENT');
        }
      }
      if (!completed) throw new Error('LLM_STREAM_INCOMPLETE');
    } catch (error) {
      if (error instanceof Error && /^LLM_STREAM_[A-Z_]+$/.test(error.message)) throw error;
      throw new Error('LLM_STREAM_PROVIDER_FAILURE');
    } finally {
      clearTimeout(timer);
      options.signal.removeEventListener('abort', onExternalAbort);
      controller.abort();
    }
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

function isSafeMetadata(value: unknown): value is GenerateAnswerResult['metadata'] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const metadata = value as Record<string, unknown>;
  const safeText = (text: unknown) => typeof text === 'string' && /^[A-Za-z0-9._:/-]{1,128}$/.test(text);
  return safeText(metadata.provider) && safeText(metadata.model)
    && typeof metadata.fallbackUsed === 'boolean'
    && (metadata.fallbackReason === undefined || safeText(metadata.fallbackReason))
    && (metadata.requestId === undefined || safeText(metadata.requestId))
    && Object.keys(metadata).every((key) => ['provider', 'model', 'fallbackUsed', 'fallbackReason', 'requestId'].includes(key));
}
