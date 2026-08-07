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
  { terms: ['查', '查詢', '看', '確認'], normalizedTerm: 'read', category: 'operation', phraseCategory: 'intent' },
  { terms: ['更新', '修改'], normalizedTerm: 'update', category: 'operation', phraseCategory: 'intent' },
  { terms: ['取消'], normalizedTerm: 'cancel', category: 'operation', phraseCategory: 'intent' },
  { terms: ['核准'], normalizedTerm: 'approve', category: 'operation', phraseCategory: 'intent' },
  { terms: ['刪除'], normalizedTerm: 'delete', category: 'operation', phraseCategory: 'intent' },
  { terms: ['今天', '昨天', '本週', '上週', '本月', '近三個月'], normalizedTerm: 'timeRange', category: 'time', phraseCategory: 'time' }
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
