import {
  decomposeSubTasks,
  inferRequiredEvidence,
  inferRiskLevel,
  inferTaskType
} from '../../src/query-understanding/query-task-decomposer';

describe('query task decomposer Customer-neutral helpers', () => {
  it.each([
    ['請查欄位說明', 'field_explanation_lookup'],
    ['請查公司政策', 'policy_lookup'],
    ['查詢錯誤代碼', 'error_code_lookup'],
    ['請依 SOP 操作流程說明', 'document_knowledge_lookup'],
    ['一般內部查詢', 'general_lookup']
  ])('classifies reusable document/general text without tool keys', (text, expected) => {
    expect(inferTaskType(text)).toBe(expected);
  });

  it('uses discovery-owned task metadata as the subtask fallback without inspecting tool keys', () => {
    expect(decomposeSubTasks(
      [{ index: 0, text: '第一個查詢' }, { index: 1, text: '第二個查詢' }],
      'metadata_owned_lookup'
    )).toEqual([
      { type: 'metadata_owned_lookup', text: '第一個查詢' },
      { type: 'metadata_owned_lookup', text: '第二個查詢' }
    ]);
  });

  it('retains generic risk and evidence classification', () => {
    expect(inferRiskLevel('請更新資料')).toBe('medium');
    expect(inferRiskLevel('緊急取消資料')).toBe('critical');
    expect(inferRequiredEvidence('general_lookup', [], [])).toEqual(['identity_context', 'manual_review']);
  });
});
