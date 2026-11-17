import { classifyControlledConversation } from '../../src/query-understanding/controlled-conversation.classifier';

/** Feature 013 T026 / SC-006: capability questions by pattern, never at the expense of data questions. */
describe('classifyControlledConversation capability_discovery patterns', () => {
  const POSITIVE = [
    '你能查詢哪些資料？', '你可以查什麼？', '你能做什麼', '請問你可以幫我查哪些東西？', '您能看什麼資料呢',
    '你有哪些功能？', '你支援哪些功能', '我可以問你什麼問題', '我能問什麼？', '可以查詢哪些資料',
    '你會做什麼？', '你可以幫我做什麼？', '你的功能有哪些', '什麼資料可以查？', '想請問你能提供哪些服務',
    '助理可以查什麼資料', '你現在可以查哪些資訊？', '你能夠回答哪些問題', '我可以查什麼', '目前能查詢哪些資料？',
    '有什麼問題可以問你', '你有什麼功能呢？', '您可以協助哪些事情？', '我要怎麼查詢工單統計？',
    '這個助理能做什麼？', '這套系統可以查哪些資料', '你們的系統有哪些功能？', '這個助理的用途是什麼', 'AI 小幫手可以幫我做什麼'
  ];
  const NEGATIVE = [
    '我可以查本月工單嗎？', '你能查詢今天新增多少工單嗎', '可以幫我查訂單 SO-10001 的狀態嗎', '我能看本週的工單統計嗎',
    '查詢今天的工單統計', '哪些工單逾期了', '有哪些訂單還沒出貨', '什麼時候會出貨', '你可以幫我比較本月跟上月嗎',
    '今天新增幾張工單', '你能查到 WO-20001 的進度嗎', '我想知道逾期工單有幾張', '有什麼工單是今天到期的',
    '幫我查詢上個月的完工率', '可以看出貨狀態嗎', '這個月新增多少', '訂單狀態有哪些', '哪些工單在生產中',
    '可以查詢庫存嗎', '我要怎麼建立工單？', '你能查什麼工單', '目前逾期工單有幾張？', '本月完工幾張工單？',
    '哈囉，今天新增多少工單？', '不用查資料，直接告訴我今天有多少工單。',
    '這個訂單可以查什麼', '這個工單的進度是什麼', '這個月可以查哪些資料', '這套系統的訂單有哪些'
  ];

  it.each(POSITIVE)('recognizes %s as a capability question', (text) => {
    expect(classifyControlledConversation(text)).toBe('capability_discovery');
  });

  it.each(NEGATIVE)('keeps %s off the capability overview path', (text) => {
    expect(classifyControlledConversation(text)).not.toBe('capability_discovery');
  });

  it('keeps greetings and help separate', () => {
    expect(classifyControlledConversation('你好')).toBe('greeting');
    expect(classifyControlledConversation('你是誰？')).toBe('assistant_help');
  });
});
