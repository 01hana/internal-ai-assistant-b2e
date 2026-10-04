import { Injectable } from '@nestjs/common';
import type { GenerateAnswerResult } from '../../llm/llm-provider.interface';
import type { GroundedGenerationContextV1 } from './grounded-generation.types';

const MAX_OUTPUT_BYTES = 4 * 1024;
const PARTIAL_DISCLOSURE = '\n未獲證據支持的部分無法確認。';
const REFERENCE = /\[([^\]\n]{1,128})\]/g;
const PROHIBITED_AUTHORITY = /(?:^|\n)\s*(?:system|developer|assistant|tool)\s*:|(?:權限已核准|permission granted|toolcall|evidenceref|connectorcontextref)/i;

@Injectable()
export class GroundedAnswerFinalizerService {
  finalize(result: GenerateAnswerResult, context: GroundedGenerationContextV1): string {
    if (result.finishReason !== 'stop' || typeof result.content !== 'string') invalid();
    const text = result.content.trim();
    if (!text || hasForbiddenControl(text) || PROHIBITED_AUTHORITY.test(text)) invalid();
    const allowed = new Set(context.allowedCitationIds);
    for (const match of text.matchAll(REFERENCE)) if (!allowed.has(match[1])) invalid();
    if (/\[[^\]\n]*$/.test(text) || /\[\[|\]\]/.test(text)) invalid();
    const finalized = context.coverage === 'PARTIAL' ? `${text}${PARTIAL_DISCLOSURE}` : text;
    if (Buffer.byteLength(finalized, 'utf8') > MAX_OUTPUT_BYTES) invalid();
    return finalized;
  }
}

function invalid(): never { throw new Error('GENERATION_OUTPUT_INVALID'); }
function hasForbiddenControl(text: string): boolean {
  return [...text].some((character) => {
    const code = character.codePointAt(0)!;
    return code < 32 && code !== 9 && code !== 10 && code !== 13;
  });
}
