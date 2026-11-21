import { capabilityOverviewText, NO_CAPABILITY_TEXT } from '../../src/query-understanding/capability-overview-text';

/** The capability overview as numbered plain-text entries. */
describe('capability overview text', () => {
  it('lists each capability once, with its periods, contents and an example question', () => {
    const text = capabilityOverviewText([
      { label: '工單統計', contents: ['新增工單', '完工率'], periods: ['今天', '本週', '本月'] },
      { label: '訂單狀態', contents: [], periods: [] }
    ]);
    expect(text).toBe([
      '依目前權限可使用的查詢功能：',
      '1. 工單統計（今天、本週、本月）\n   內容：新增工單、完工率\n   例如：「請查詢今天的工單統計」',
      '2. 訂單狀態\n   例如：「請查詢訂單狀態」',
      '請直接用自然語言提問；實際查詢時仍會驗證資料範圍。'
    ].join('\n\n'));
    expect(text).not.toMatch(/\*\*|^#/m);
  });

  it('says how to get access when nothing is available', () => {
    expect(capabilityOverviewText([])).toBe(NO_CAPABILITY_TEXT);
  });
});
