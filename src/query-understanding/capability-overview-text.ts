/** One capability the actor may query now, as the overview lists it (from `describeAvailable`). */
export type AvailableCapabilitySummary = {
  label: string;
  /** Approved output fields the answer can contain, at most 12. */
  contents: readonly string[];
  /** Periods the actor may ask for (今天、本週…), in catalogue order. */
  periods: readonly string[];
};

const HEADING = '依目前權限可使用的查詢功能：';
const CLOSING = '請直接用自然語言提問；實際查詢時仍會驗證資料範圍。';
export const NO_CAPABILITY_TEXT = '目前沒有可使用的查詢功能。如需使用，請向系統管理者申請權限。';

/**
 * The capability overview as short plain-text lines (both the Assistant window and the
 * back office keep line breaks and show no Markdown): a numbered entry per capability with its periods,
 * what it contains, and an example question.
 */
export function capabilityOverviewText(capabilities: readonly AvailableCapabilitySummary[]): string {
  if (capabilities.length === 0) return NO_CAPABILITY_TEXT;
  const entries = capabilities.map((capability, index) => {
    const periods = capability.periods.length > 0 ? `（${capability.periods.join('、')}）` : '';
    const lines = [`${index + 1}. ${capability.label}${periods}`];
    if (capability.contents.length > 0) lines.push(`   內容：${capability.contents.join('、')}`);
    lines.push(`   例如：「請查詢${capability.periods[0] ? `${capability.periods[0]}的` : ''}${capability.label}」`);
    return lines.join('\n');
  });
  return [HEADING, ...entries, CLOSING].join('\n\n');
}
