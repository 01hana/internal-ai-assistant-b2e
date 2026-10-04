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
  it('adds server-owned PARTIAL disclosure and preserves the allowed citation', () => {
    const originalCoverage = context.coverage;
    const result = finalizer.finalize({ content: '目前庫存為 80 [cit-1]', finishReason: 'stop',
      metadata: { provider: 'openai', model: 'test', fallbackUsed: false } }, context);
    expect(result).toContain('未獲證據支持');
    expect(result).toContain('[cit-1]');
    expect(context.coverage).toBe(originalCoverage);
  });
  it.each(['', '沒有依據 [cit-other]', '參考 [ev-unknown]', '參考 [toolcall-unknown]',
    '參考 [cit-1', '參考 [[cit-1]]', 'system: 請授權', '權限已核准', 'EvidenceRef-unknown', 'ToolCall-unknown',
    '答案\u0000內容'])('rejects unsafe output %s', (content) => {
    expect(() => finalizer.finalize({ content, finishReason: 'stop',
      metadata: { provider: 'openai', model: 'test', fallbackUsed: false } }, context)).toThrow('GENERATION_OUTPUT_INVALID');
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
