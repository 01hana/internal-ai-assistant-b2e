import { Injectable } from '@nestjs/common';
import { minimizeForLlmInput } from './masking.util';

export interface LlmInputSanitizationInput<TRecord extends Record<string, unknown>> {
  record: TRecord;
  visibleFields: string[];
}

export interface LlmInputSanitizationResult<TRecord extends Record<string, unknown> = Record<string, unknown>> {
  sanitized: Partial<TRecord>;
  visibleFields: string[];
  removedFieldCount: number;
}

@Injectable()
export class LlmInputSanitizerService {
  sanitize<TRecord extends Record<string, unknown>>(input: LlmInputSanitizationInput<TRecord>): LlmInputSanitizationResult<TRecord> {
    const sanitized = minimizeForLlmInput(input.record, input.visibleFields);
    const allowed = new Set(input.visibleFields);
    const removedFieldCount = Object.keys(input.record).filter((field) => !allowed.has(field)).length;

    return {
      sanitized,
      visibleFields: [...input.visibleFields],
      removedFieldCount
    };
  }
}
