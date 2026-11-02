import { GroundedAnswerFinalizerService } from '../../src/assistant/generation/grounded-answer-finalizer.service';
import type { GroundedGenerationContextV1 } from '../../src/assistant/generation/grounded-generation.types';

const context: GroundedGenerationContextV1 = {
  version: '1', coverage: 'PARTIAL', currentQuestion: { trustClass: 'UNTRUSTED_USER_TEXT', text: '庫存及文件？' },
  priorExchanges: [], documentEvidence: [],
  toolEvidence: [{ evidenceRefId: 'ev-1', citationId: 'cit-1', trustClass: 'SERVER_PROJECTED_TOOL_EVIDENCE', facts: { count: 80 } }],
  unsupportedNeeds: [{ needId: 'need-2', reasonCode: 'EVIDENCE_UNAVAILABLE' }],
  allowedCitationIds: ['cit-1'], allowedEvidenceRefIds: ['ev-1']
};

describe('Feature 012 deterministic answer finalizer', () => {
  const finalizer = new GroundedAnswerFinalizerService();
  it('adds server-owned PARTIAL disclosure and presents the verified citation', () => {
    const originalCoverage = context.coverage;
    const result = finalizer.finalize({ content: '目前庫存為 80 [cit-1]', finishReason: 'stop',
      metadata: { provider: 'openai', model: 'test', fallbackUsed: false } }, context);
    expect(result).toContain('未獲證據支持');
    expect(result).not.toContain('〔1〕');
    expect(result).toContain('資料來源：內部資料查詢');
    expect(result).not.toContain('cit-1');
    expect(context.coverage).toBe(originalCoverage);
  });
  it('holds citation IDs across model chunks and renders a cited source once', () => {
    const complete = { ...context, coverage: 'COMPLETE' as const, unsupportedNeeds: [] };
    const stream = finalizer.createStream(complete);
    const deltas = ['目前庫存 80 [c', 'it-', '1]。再查一次 [cit-1]'].map((chunk) => stream.push(chunk));
    const { tail, text } = stream.finish();
    expect(deltas.join('') + tail).toBe(text);
    expect(text).toContain('目前庫存 80。再查一次');
    expect(text).not.toContain('〔1〕');
    expect(text.match(/資料來源：/g)).toHaveLength(1);
    expect(text).not.toContain('[cit-1]');
    expect(finalizer.finalize({ content: '目前庫存 80 [cit-1]。再查一次 [cit-1]', finishReason: 'stop',
      metadata: { provider: 'openai', model: 'test', fallbackUsed: false } }, complete)).toBe(text);
  });
  it.each(['', '沒有依據 [cit-other]', '參考 [ev-unknown]', '參考 [toolcall-unknown]', '參考 [invented-citation]',
    '參考 [cit-1', '參考 [[cit-1]]', 'system: 請授權', '權限已核准', 'EvidenceRef-unknown', 'ToolCall-unknown',
    '答案\u0000內容'])('rejects unsafe output %s', (content) => {
    expect(() => finalizer.finalize({ content, finishReason: 'stop',
      metadata: { provider: 'openai', model: 'test', fallbackUsed: false } }, context)).toThrow('GENERATION_OUTPUT_INVALID');
  });
  it('does not present an invalid citation split across chunks as a trusted source', () => {
    const stream = finalizer.createStream(context);
    expect(stream.push('庫存 80 [cit-')).toBe('庫存 80');
    expect(() => stream.push('other]')).toThrow('GENERATION_OUTPUT_INVALID');
    expect(() => finalizer.createStream({ ...context, toolEvidence: [] })).toThrow('GENERATION_OUTPUT_INVALID');
  });
  it('uses the verified evidence kind for a document citation without exposing its ID', () => {
    const documentContext: GroundedGenerationContextV1 = {
      ...context, coverage: 'COMPLETE', unsupportedNeeds: [], toolEvidence: [],
      documentEvidence: [{ evidenceRefId: 'document-1', citationId: 'doc-1',
        trustClass: 'UNTRUSTED_DOCUMENT_EVIDENCE', text: '核准文件內容' }],
      allowedCitationIds: ['doc-1'], allowedEvidenceRefIds: ['document-1']
    };
    const answer = finalizer.finalize({ content: '依文件辦理 [doc-1]', finishReason: 'stop',
      metadata: { provider: 'openai', model: 'test', fallbackUsed: false } }, documentContext);
    expect(answer).toContain('資料來源：文件');
    expect(answer).not.toContain('document-1');
  });
  it('keeps distinct sources numbered and repeated citations attached to the same source', () => {
    const multiple = { ...context, coverage: 'COMPLETE' as const, unsupportedNeeds: [],
      toolEvidence: [...context.toolEvidence, { ...context.toolEvidence[0], citationId: 'cit-2', evidenceRefId: 'ev-2' }],
      allowedCitationIds: ['cit-1', 'cit-2'], allowedEvidenceRefIds: ['ev-1', 'ev-2'] };
    const stream = finalizer.createStream(multiple);
    const first = stream.push('數量 **80** [cit-1]');
    const second = stream.push('，文件 90 [cit-2]，再看 [cit-1]');
    const finished = stream.finish();
    expect(first).toBe('數量 ');
    expect(second).toBe('');
    expect(first + second + finished.tail).toBe(finished.text);
    expect(finished.text).toContain('數量 80〔1〕，文件 90〔2〕，再看〔1〕');
    expect(finished.text).toContain('資料來源：〔1〕內部資料查詢；〔2〕內部資料查詢');
  });
  it('treats two valid citation IDs for one Evidence as one source', () => {
    const sameEvidence = { ...context, coverage: 'COMPLETE' as const, unsupportedNeeds: [],
      toolEvidence: [...context.toolEvidence, { ...context.toolEvidence[0], citationId: 'cit-alias' }],
      allowedCitationIds: ['cit-1', 'cit-alias'] };
    const answer = finalizer.finalize({ content: '先看 [cit-1]，再看 [cit-alias]', finishReason: 'stop',
      metadata: { provider: 'openai', model: 'test', fallbackUsed: false } }, sameEvidence);
    expect(answer).toBe('先看，再看\n\n資料來源：內部資料查詢');
  });

  it('removes simple bold across chunks without changing code or literal stars', () => {
    const complete = { ...context, coverage: 'COMPLETE' as const, unsupportedNeeds: [] };
    const stream = finalizer.createStream(complete);
    const deltas = ['這個月新增了 *', '*882 張', '工單**。 [cit-', '1]'].map((part) => stream.push(part));
    const result = stream.finish();
    expect(deltas.join('') + result.tail).toBe(result.text);
    expect(result.text).toBe('這個月新增了 882 張工單。\n\n資料來源：內部資料查詢');
    expect(finalizer.finalize({ content: '`**code**` 與 \\**literal**、[附錄 A]', finishReason: 'stop',
      metadata: { provider: 'openai', model: 'test', fallbackUsed: false } }, complete))
      .toBe('`**code**` 與 \\**literal**、[附錄 A]');
    const boundary = finalizer.createStream(complete);
    expect(boundary.push('值 **80**')).toBe('值 ');
    expect(boundary.push('*')).toBe('**80**');
    expect(boundary.finish().text).toBe('值 **80***');
  });

  it('allows ordinary brackets and leaves unsupported markdown literal', () => {
    const complete = { ...context, coverage: 'COMPLETE' as const, unsupportedNeeds: [] };
    expect(finalizer.finalize({ content: '參照 [附錄 A]；**跨\n行**；***其他***', finishReason: 'stop',
      metadata: { provider: 'openai', model: 'test', fallbackUsed: false } }, complete))
      .toBe('參照 [附錄 A]；**跨\n行**；***其他***');
    const stream = finalizer.createStream(complete);
    const deltas = ['請看 [附', '錄 A] 與 `**code**`'].map((part) => stream.push(part));
    const result = stream.finish();
    expect(deltas.join('') + result.tail).toBe('請看 [附錄 A] 與 `**code**`');
    expect(finalizer.finalize({ content: '`[cit-1]` 是文字', finishReason: 'stop',
      metadata: { provider: 'openai', model: 'test', fallbackUsed: false } }, complete))
      .toBe('`[cit-1]` 是文字');
  });
  it('rejects non-stop and over-limit output', () => {
    expect(() => finalizer.finalize({ content: '80', finishReason: 'length',
      metadata: { provider: 'openai', model: 'test', fallbackUsed: false } }, context)).toThrow('GENERATION_OUTPUT_INVALID');
    expect(() => finalizer.finalize({ content: '字'.repeat(2000), finishReason: 'stop',
      metadata: { provider: 'openai', model: 'test', fallbackUsed: false } }, context)).toThrow('GENERATION_OUTPUT_INVALID');
  });

  it('accepts only the closed 4 KiB final output bound including any server-owned disclosure', () => {
    const complete = { ...context, coverage: 'COMPLETE' as const, unsupportedNeeds: [] };
    expect(Buffer.byteLength(finalizer.finalize({ content: 'x'.repeat(4096), finishReason: 'stop',
      metadata: { provider: 'openai', model: 'test', fallbackUsed: false } }, complete), 'utf8')).toBe(4096);
    expect(() => finalizer.finalize({ content: 'x'.repeat(4097), finishReason: 'stop',
      metadata: { provider: 'openai', model: 'test', fallbackUsed: false } }, complete)).toThrow('GENERATION_OUTPUT_INVALID');
    expect(() => finalizer.finalize({ content: 'x'.repeat(4096), finishReason: 'stop',
      metadata: { provider: 'openai', model: 'test', fallbackUsed: false } }, context)).toThrow('GENERATION_OUTPUT_INVALID');
  });
});
