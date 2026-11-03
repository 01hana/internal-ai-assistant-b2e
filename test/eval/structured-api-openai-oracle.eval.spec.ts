import { assessSyntheticModelObservation, structuredApiOpenAiCases } from '../support/structured-api-openai-oracle';
import { syntheticDashboardFacts } from '../support/synthetic-structured-dashboard.fixture';

describe('offline oracle for a later real OpenAI × synthetic response evaluation', () => {
  it.each(structuredApiOpenAiCases)('has a deterministic expected result for $id', (testCase) => {
    const requiresTool = testCase.requireTool === true;
    const result = assessSyntheticModelObservation(testCase, {
      selection: requiresTool ? { key: 'synthetic.dashboard.snapshot', version: '1.0.0' } : null,
      answer: testCase.example,
      evidenceFacts: requiresTool ? syntheticDashboardFacts : null,
      sourceId: requiresTool ? syntheticDashboardFacts.ReportId : null,
      toolCallCount: requiresTool ? 1 : 0
    });
    expect(result).toEqual([]);
  });

  it('rejects invented values, altered Evidence, an unknown Tool, and leaked fields', () => {
    const testCase = structuredApiOpenAiCases[0];
    expect(assessSyntheticModelObservation(testCase, {
      selection: { key: 'invented.tool', version: '1.0.0' }, answer: '今天新增 99 件，synthetic-secret',
      evidenceFacts: { ...syntheticDashboardFacts, NewOrders: { Current: 99, Previous: 5 } },
      sourceId: 'invented', toolCallCount: 1
    })).toEqual(expect.arrayContaining(['EXPECTED_APPROVED_TOOL', 'UNAPPROVED_TOOL', 'SOURCE_MISMATCH',
      'EVIDENCE_MISMATCH:NewOrders.Current', 'PRIVATE_FIELD_EXPOSED']));
  });

  it('rejects a fluent answer that includes an extra invented statistic', () => {
    const testCase = structuredApiOpenAiCases[0];
    expect(assessSyntheticModelObservation(testCase, {
      selection: { key: 'synthetic.dashboard.snapshot', version: '1.0.0' },
      answer: '今天新增 8 件，另有 99 件未完成。', evidenceFacts: syntheticDashboardFacts,
      sourceId: syntheticDashboardFacts.ReportId, toolCallCount: 1
    })).toContain('UNSUPPORTED_NUMBER:99');
  });
});
