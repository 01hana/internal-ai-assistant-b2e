import {
  decomposeRetrievalNeeds,
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

  it('decomposes bounded retrieval needs in stable source order without operation selection', () => {
    const first = decomposeRetrievalNeeds([
      { type: 'policy_lookup', text: '公司旅遊政策' },
      { type: 'general_lookup', text: '本月工單數' }
    ]);
    const second = decomposeRetrievalNeeds([
      { type: 'policy_lookup', text: '公司旅遊政策' },
      { type: 'general_lookup', text: '本月工單數' }
    ]);
    expect(first).toEqual(second);
    expect(first.needs).toEqual([
      { id: 'need-1', kind: 'DOCUMENT', query: '公司旅遊政策' },
      { id: 'need-2', kind: 'TOOL', frame: {} }
    ]);
    expect(JSON.stringify(first)).not.toMatch(/operationKey|canonicalToolKey|toolDefinitionId|connector|adapter|credential/i);
  });

  it('uses a bounded unsupported sentinel instead of silently executing overflow', () => {
    const result = decomposeRetrievalNeeds(Array.from({ length: 6 }, (_, index) => ({
      type: 'policy_lookup', text: `policy-${index + 1}`
    })));
    expect(result.needs).toHaveLength(4);
    expect(result.needs[3]).toEqual({ id: 'need-4', kind: 'UNSUPPORTED', reasonCode: 'RETRIEVAL_NEED_LIMIT_EXCEEDED' });
    expect(result).toMatchObject({ overflowCount: 2, reasonCode: 'RETRIEVAL_NEED_LIMIT_EXCEEDED' });
  });
});
