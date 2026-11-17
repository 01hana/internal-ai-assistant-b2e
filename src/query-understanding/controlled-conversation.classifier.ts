export type ControlledConversationIntent = 'greeting' | 'assistant_help' | 'capability_discovery';

/**
 * Recognizes only complete, low-risk meta utterances; mixed or uncertain requests use the existing gates.
 * Feature 013 US2: capability questions are matched by sentence pattern after normalization instead of an
 * exact sentence list, but any data-request signal keeps the text on the business query path (SC-006).
 * Patterns are generic product language and contain no Customer vocabulary.
 */
export function classifyControlledConversation(text: string): ControlledConversationIntent | undefined {
  const value = text.normalize('NFKC').trim().replace(/[。！!？?～~．.]+$/u, '').trim();
  if (/^(哈囉|你好|您好|嗨|謝謝|感謝|多謝)$/u.test(value)) return 'greeting';
  if (/^(你是誰|你是什麼|怎麼使用(?:你|助理|Assistant)|我要怎麼使用(?:你|助理|Assistant)|我要怎麼問你問題|怎麼問你問題)$/iu.test(value)) return 'assistant_help';
  if (/^(我可以查什麼|我能查詢哪些資料|我可以查詢哪些資料|你能夠查詢什麼資料|你能查詢什麼資料|你可以幫我做什麼|你能做什麼|目前支援哪些功能|目前有哪些查詢功能|目前能查詢哪些資料|可以查詢哪些資料|有什麼問題可以問你)$/u.test(value)) return 'capability_discovery';
  // Pre-Feature 013 rule, unchanged: "how do I query X" without a period, quantity or comparison.
  if (/^(?:我要)?怎麼查詢[^，。；、?？!！]{1,24}$/u.test(value) &&
    !/(多少|幾筆|幾張|目前|今天|昨天|本週|上週|本月|上月|上個月|跟|比較|順便|還有|以及)/u.test(value)) return 'capability_discovery';
  const core = stripPolitenessAndParticles(value);
  if (core.length > 0 && core.length <= 24 && !DATA_REQUEST_SIGNAL.test(core) &&
    CAPABILITY_QUESTION_PATTERNS.some((pattern) => pattern.test(core))) return 'capability_discovery';
  return undefined;
}

/** Words that indicate the user is asking for data, a period, a comparison or a specific record. */
const DATA_REQUEST_SIGNAL = /(多少|幾筆|幾張|幾個|幾件|幾單|數量|總數|統計|狀態|進度|明細|清單|今天|今日|昨天|本週|這週|這個禮拜|上週|本月|這個月|上月|上個月|今年|去年|比較|跟|順便|還有|以及|編號|[A-Za-z]{2,}-?\d|\d)/u;

// "這個助理" / "這套系統" / "你們的系統" refer to the Assistant itself, not to an earlier business entity.
const SUBJECT = '(?:(?:這個|這套|你們的|你們|此)?(?:AI)?(?:助理|系統|機器人|小幫手)|(?:這個|這套|你們的)?AI|你們|你|您)?';
const NOW = '(?:現在|目前)?';
const ABLE = '(?:可以|能夠|能|會|可|有辦法)?';
const HELP = '(?:幫我|幫忙|替我|協助)?';
const ACT = '(?:查詢|查到|查|看到|看|找|做|處理|回答|提供|協助)';
const WHAT = '(?:哪些|那些|什麼|甚麼)';
const OBJECT = '(?:資料|資訊|東西|功能|事情|事|內容|項目|問題|服務)?';

const CAPABILITY_QUESTION_PATTERNS: readonly RegExp[] = Object.freeze([
  // 你能查詢哪些資料 / 你可以幫我做什麼 / 助理現在可以查哪些資訊
  new RegExp(`^${SUBJECT}${NOW}${ABLE}${HELP}${ACT}(?:些)?${WHAT}${OBJECT}$`, 'u'),
  // 你有哪些功能 / 你支援什麼服務
  new RegExp(`^${SUBJECT}${NOW}(?:有|支援|提供)${WHAT}(?:功能|服務|查詢功能|能力)$`, 'u'),
  // 我可以問你什麼問題 / 我能問什麼
  new RegExp(`^(?:我)?${ABLE}(?:問|查詢|查)(?:你|您)?${WHAT}(?:問題|資料|東西)?$`, 'u'),
  // 你的功能有哪些 / 這個助理的用途是什麼
  new RegExp(`^${SUBJECT}的?(?:功能|能力|用途)(?:有)?(?:哪些|什麼|是什麼)$`, 'u'),
  // 什麼資料可以查
  new RegExp(`^${WHAT}(?:資料|東西|功能)(?:是)?${ABLE}(?:查詢|查|問)(?:的)?$`, 'u')
]);

function stripPolitenessAndParticles(value: string): string {
  return value
    .replace(/\s+/gu, '')
    .replace(/^(?:想請問|請問|想問|想知道|我想知道|我想問|請告訴我|麻煩|那)+/u, '')
    .replace(/(?:嗎|呢|啊|呀|吧|哦|喔)+$/u, '');
}
