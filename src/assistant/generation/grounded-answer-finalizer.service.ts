import { Injectable } from '@nestjs/common';
import type { GenerateAnswerResult } from '../../llm/llm-provider.interface';
import type { GroundedGenerationContextV1 } from './grounded-generation.types';
import { presentSimpleBold } from './answer-presentation';

const MAX_OUTPUT_BYTES = 4 * 1024;
const PARTIAL_DISCLOSURE = '\n未獲證據支持的部分無法確認。';
const PROHIBITED_AUTHORITY = /(?:^|\n)\s*(?:system|developer|assistant|tool)\s*:|(?:權限已核准|permission granted|toolcall|evidenceref|connectorcontextref)/i;

/** Keeps incomplete citation markers and trailing whitespace out of SSE deltas. */
export class GroundedCitationStreamRenderer {
  private readonly allowed = new Map<string, { evidenceRefId: string; label: string }>();
  private raw = '';
  private emitted = '';

  constructor(private readonly context: GroundedGenerationContextV1) {
    const allowedIds = new Set(context.allowedCitationIds);
    const allowedRefs = new Set(context.allowedEvidenceRefIds);
    for (const item of context.toolEvidence) this.register(item.citationId, item.evidenceRefId, '內部資料查詢', allowedIds, allowedRefs);
    for (const item of context.documentEvidence) this.register(item.citationId, item.evidenceRefId, '文件', allowedIds, allowedRefs);
    if (this.allowed.size !== allowedIds.size) invalid();
  }

  push(chunk: string): string {
    this.raw += chunk;
    if (Buffer.byteLength(this.raw, 'utf8') > MAX_OUTPUT_BYTES) invalid();
    const scan = this.scan(false);
    // Once a citation is seen, later prose waits until the source count is known.
    const stable = this.raw.slice(0, scan.firstCitation ?? scan.unfinishedBracket ?? this.raw.length).trim();
    const presented = presentSimpleBold(stable, false);
    if (!presented.startsWith(this.emitted)) invalid();
    const delta = presented.slice(this.emitted.length);
    this.emitted = presented;
    return delta;
  }

  finish(): { readonly tail: string; readonly text: string } {
    const scan = this.scan(true);
    if (!this.raw.trim()) invalid();
    const single = scan.sources.size === 1;
    const numbered = new Map([...scan.sources.keys()].map((id, index) => [id, index + 1]));
    let bodyRaw = '';
    let offset = 0;
    for (const reference of scan.references) {
      bodyRaw += this.raw.slice(offset, reference.start).replace(/[ \t]*$/u, '');
      if (!single) bodyRaw += `〔${numbered.get(reference.evidenceRefId)}〕`;
      offset = reference.end;
    }
    bodyRaw += this.raw.slice(offset);
    const body = presentSimpleBold(bodyRaw.trim());
    if (!body.startsWith(this.emitted)) invalid();
    const disclosure = this.context.coverage === 'PARTIAL' ? PARTIAL_DISCLOSURE : '';
    const sourceLine = scan.sources.size > 0
      ? `\n\n資料來源：${[...scan.sources.values()].map((label, index) => single ? label : `〔${index + 1}〕${label}`).join('；')}` : '';
    const text = body + disclosure + sourceLine;
    if (Buffer.byteLength(text, 'utf8') > MAX_OUTPUT_BYTES) invalid();
    return { tail: text.slice(this.emitted.length), text };
  }

  private register(id: string, evidenceRefId: string, label: string, allowedIds: Set<string>, allowedRefs: Set<string>): void {
    if (!allowedIds.has(id) || !allowedRefs.has(evidenceRefId) || this.allowed.has(id)) invalid();
    this.allowed.set(id, { evidenceRefId, label });
  }

  private scan(complete: boolean): {
    firstCitation?: number; unfinishedBracket?: number; sources: Map<string, string>;
    references: Array<{ start: number; end: number; evidenceRefId: string }>;
  } {
    const sources = new Map<string, string>();
    const references: Array<{ start: number; end: number; evidenceRefId: string }> = [];
    let firstCitation: number | undefined;
    let codeTicks = 0;
    for (let index = 0; index < this.raw.length;) {
      if (this.raw[index] === '\\' && index + 1 < this.raw.length) { index += 2; continue; }
      if (this.raw[index] === '`') {
        let end = index + 1;
        while (this.raw[end] === '`') end++;
        const ticks = end - index;
        if (codeTicks === 0) codeTicks = ticks;
        else if (codeTicks === ticks) codeTicks = 0;
        index = end;
        continue;
      }
      if (codeTicks !== 0) { index++; continue; }
      if (this.raw[index] !== '[') { index++; continue; }
      const end = this.raw.indexOf(']', index + 1);
      if (end < 0) {
        if (complete && looksLikeCitation(this.raw.slice(index + 1))) invalid();
        return { firstCitation, unfinishedBracket: index, sources, references };
      }
      const id = this.raw.slice(index + 1, end);
      const source = this.allowed.get(id);
      if (source) {
        if (firstCitation === undefined) firstCitation = index;
        if (!sources.has(source.evidenceRefId)) sources.set(source.evidenceRefId, source.label);
        references.push({ start: index, end: end + 1, evidenceRefId: source.evidenceRefId });
      } else if (looksLikeCitation(id) || this.looksLikeAllowedId(id)) invalid();
      index = end + 1;
    }
    return { firstCitation, sources, references };
  }

  private looksLikeAllowedId(id: string): boolean {
    return [...this.allowed.keys()].some((allowed) => {
      const separator = allowed.lastIndexOf('-');
      return separator >= 3 && id.startsWith(allowed.slice(0, separator + 1));
    });
  }
}

function looksLikeCitation(value: string): boolean {
  return /^(?:citation|cit|ev|evidence|toolcall)[-:]/iu.test(value) ||
    /(?:^|[-[])(?:citation|cit|evidence|toolcall)(?:[-:\]]|$)/iu.test(value) ||
    /\[(?:citation|cit|ev|evidence|toolcall)[-:]/iu.test(value);
}

@Injectable()
export class GroundedAnswerFinalizerService {
  finalize(result: GenerateAnswerResult, context: GroundedGenerationContextV1): string {
    if (result.finishReason !== 'stop' || typeof result.content !== 'string') invalid();
    const text = result.content.trim();
    if (!text || hasForbiddenControl(text) || PROHIBITED_AUTHORITY.test(text)) invalid();
    const renderer = this.createStream(context);
    renderer.push(text);
    return renderer.finish().text;
  }

  createStream(context: GroundedGenerationContextV1): GroundedCitationStreamRenderer {
    return new GroundedCitationStreamRenderer(context);
  }
}

function invalid(): never { throw new Error('GENERATION_OUTPUT_INVALID'); }
function hasForbiddenControl(text: string): boolean {
  return [...text].some((character) => {
    const code = character.codePointAt(0)!;
    return code < 32 && code !== 9 && code !== 10 && code !== 13;
  });
}
