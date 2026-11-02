import { AnswerDecisionStatus, AssistantMessageRole } from '../../src/generated/prisma/enums';
import { mapAssistantHistoryMessage } from '../../src/assistant/history/assistant-history.mapper';

const message = {
  id: 'message-1', role: AssistantMessageRole.assistant,
  content: '這個月新增 882 張工單。 [citation-need-1-1]',
  createdAt: new Date('2026-10-23T07:36:17Z'), answerDecision: AnswerDecisionStatus.answered
};
const evidence = [{ id: 'evidence-1', customerId: 'customer-a', messageId: 'message-1', sourceType: 'structured_record' }];
const decision = { needResults: [{ needId: 'need-1', evidenceRefIds: ['evidence-1'] }] };

describe('Assistant history citation presentation', () => {
  it('presents a persisted legacy citation only when its decision and evidence agree', () => {
    const result = mapAssistantHistoryMessage(message, [], evidence, [], decision);
    expect(result.content).toContain('這個月新增 882 張工單。');
    expect(result.content).not.toContain('〔1〕');
    expect(result.content).toContain('資料來源：內部資料查詢');
    expect(result.content).not.toContain('citation-need-1-1');
  });

  it('does not claim a source when the persisted citation cannot be verified', () => {
    const result = mapAssistantHistoryMessage(message, [], [], [], decision);
    expect(result.content).toContain('〔來源待驗證〕');
    expect(result.content).not.toContain('資料來源：');
    expect(result.content).not.toContain('citation-need-1-1');
  });

  it('converts an older numbered answer once and leaves the new format unchanged on reload', () => {
    const content = '這個月新增 882 張工單。 〔1〕\n資料來源：〔1〕內部資料查詢';
    const first = mapAssistantHistoryMessage({ ...message, content }, [], evidence, [], decision).content;
    expect(first).toBe('這個月新增 882 張工單。\n\n資料來源：內部資料查詢');
    expect(mapAssistantHistoryMessage({ ...message, content: first }, [], evidence, [], decision).content).toBe(first);
  });

  it('removes simple bold from old history without inventing sources', () => {
    const result = mapAssistantHistoryMessage({ ...message, content: '新增 **882 張**。[附錄 A]' }, [], [], [], decision);
    expect(result.content).toBe('新增 882 張。[附錄 A]');
  });

  it('keeps separate verified historical sources numbered', () => {
    const content = '對照 [citation-need-1-1] 與 [citation-need-1-2]';
    const twoEvidence = [...evidence, { ...evidence[0], id: 'evidence-2', sourceType: 'document_chunk' }];
    const twoDecision = { needResults: [{ needId: 'need-1', evidenceRefIds: ['evidence-1', 'evidence-2'] }] };
    expect(mapAssistantHistoryMessage({ ...message, content }, [], twoEvidence, [], twoDecision).content)
      .toBe('對照〔1〕 與〔2〕\n\n資料來源：〔1〕內部資料查詢；〔2〕文件');
  });
});
