export type ControlledConversationIntent = 'greeting' | 'assistant_help' | 'capability_discovery';

/** Intentionally recognizes only complete, low-risk utterances. Mixed or uncertain requests use the existing gates. */
export function classifyControlledConversation(text: string): ControlledConversationIntent | undefined {
  const value = text.trim().replace(/[。！!？?]+$/u, '').trim();
  if (/^(哈囉|你好|您好|嗨|謝謝|感謝|多謝)$/u.test(value)) return 'greeting';
  if (/^(你是誰|你是什麼|怎麼使用(?:你|助理|Assistant)|我要怎麼使用(?:你|助理|Assistant)|我要怎麼問你問題|怎麼問你問題)$/iu.test(value)) return 'assistant_help';
  if (/^(我可以查什麼|我能查詢哪些資料|我可以查詢哪些資料|你能夠查詢什麼資料|你能查詢什麼資料|你可以幫我做什麼|你能做什麼|目前支援哪些功能|目前有哪些查詢功能|目前能查詢哪些資料|可以查詢哪些資料|有什麼問題可以問你)$/u.test(value)) return 'capability_discovery';
  if (/^(?:我要)?怎麼查詢[^，。；、?？!！]{1,24}$/u.test(value) &&
    !/(多少|幾筆|幾張|目前|今天|昨天|本週|上週|本月|上月|上個月|跟|比較|順便|還有|以及)/u.test(value)) return 'capability_discovery';
  return undefined;
}
