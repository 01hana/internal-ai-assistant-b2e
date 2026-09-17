import { QueryUnderstandingNormalizedTerm, QueryUnderstandingPhrase } from './query-understanding.types';

export type DomainLexiconCategory = QueryUnderstandingNormalizedTerm['category'];

export interface DomainLexiconEntry {
  terms: string[];
  normalizedTerm: string;
  category: DomainLexiconCategory;
  phraseCategory: QueryUnderstandingPhrase['category'];
}

export const DOMAIN_LEXICON: DomainLexiconEntry[] = [
  { terms: ['工單', '製令'], normalizedTerm: 'workOrder', category: 'resource', phraseCategory: 'resource' },
  { terms: ['料號', '品號', 'SKU'], normalizedTerm: 'itemSku', category: 'entity', phraseCategory: 'resource' },
  { terms: ['訂單', '銷售單'], normalizedTerm: 'order', category: 'resource', phraseCategory: 'resource' },
  { terms: ['客戶', '供應商'], normalizedTerm: 'businessPartner', category: 'resource', phraseCategory: 'resource' },
  { terms: ['庫存'], normalizedTerm: 'inventory', category: 'resource', phraseCategory: 'resource' },
  { terms: ['旅遊補助', '員工旅遊補助'], normalizedTerm: 'travelSubsidyPolicy', category: 'resource', phraseCategory: 'resource' },
  { terms: ['申請期限'], normalizedTerm: 'applicationDeadline', category: 'metric', phraseCategory: 'metric' },
  { terms: ['補助規定', '補助政策'], normalizedTerm: 'policyOverview', category: 'metric', phraseCategory: 'metric' },
  { terms: ['狀態'], normalizedTerm: 'status', category: 'metric', phraseCategory: 'metric' },
  { terms: ['進度'], normalizedTerm: 'progress', category: 'metric', phraseCategory: 'metric' },
  { terms: ['可用', '可用量'], normalizedTerm: 'availability', category: 'metric', phraseCategory: 'metric' },
  { terms: ['歷史'], normalizedTerm: 'history', category: 'metric', phraseCategory: 'metric' },
  { terms: ['存量'], normalizedTerm: 'stock', category: 'resource', phraseCategory: 'resource' },
  { terms: ['筆數', '幾筆', '幾張'], normalizedTerm: 'count', category: 'metric', phraseCategory: 'metric' },
  { terms: ['新增'], normalizedTerm: 'newCount', category: 'metric', phraseCategory: 'metric' },
  { terms: ['查', '查詢', '看', '確認'], normalizedTerm: 'read', category: 'operation', phraseCategory: 'intent' },
  { terms: ['查找', '查閱'], normalizedTerm: 'lookup', category: 'operation', phraseCategory: 'intent' },
  { terms: ['更新', '修改'], normalizedTerm: 'update', category: 'operation', phraseCategory: 'intent' },
  { terms: ['取消'], normalizedTerm: 'cancel', category: 'operation', phraseCategory: 'intent' },
  { terms: ['核准'], normalizedTerm: 'approve', category: 'operation', phraseCategory: 'intent' },
  { terms: ['刪除'], normalizedTerm: 'delete', category: 'operation', phraseCategory: 'intent' },
  { terms: ['今天', '昨天', '本週', '上週', '本月', '這個月', '上個月', '近三個月'], normalizedTerm: 'timeRange', category: 'time', phraseCategory: 'time' },
  { terms: ['本月', '這個月'], normalizedTerm: 'this_month', category: 'time', phraseCategory: 'time' },
  { terms: ['上個月'], normalizedTerm: 'last_month', category: 'time', phraseCategory: 'time' }
];

export const BUSINESS_TERMS = DOMAIN_LEXICON.flatMap((entry) => entry.terms);

export function findDomainLexiconEntry(term: string): DomainLexiconEntry | undefined {
  return DOMAIN_LEXICON.find((entry) => entry.terms.includes(term));
}

export function getNormalizedDomainTerm(term: string): string {
  return findDomainLexiconEntry(term)?.normalizedTerm ?? term;
}

export function getPhraseCategoryForNormalizedTerm(normalizedTerm: string): QueryUnderstandingPhrase['category'] {
  return DOMAIN_LEXICON.find((entry) => entry.normalizedTerm === normalizedTerm)?.phraseCategory ?? 'unknown';
}
