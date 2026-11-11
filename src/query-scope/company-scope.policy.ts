import type { QueryScopeDecision, QueryScopePolicyInput } from './query-scope.types';

/**
 * Vocabulary for the generic "current company only" scope policy (zh-TW).
 *
 * Core owns only the sentence structure below. Every word list is supplied by a
 * Customer-owned configuration file loaded at startup, so Core never hardcodes a
 * Customer's vocabulary.
 */
export interface CompanyScopeVocabularyV1 {
  /** Prefixes that name the signed-in company when followed by a current-company noun. */
  readonly currentCompanyPrefixes: readonly string[];
  readonly currentCompanyNouns: readonly string[];
  /** Nouns that denote a company after an other/vague/negated qualifier. */
  readonly companyNouns: readonly string[];
  readonly otherCompanyQualifiers: readonly string[];
  readonly vagueCompanyQualifiers: readonly string[];
  /** Any term that signals the clause talks about some company (matched case-insensitively). */
  readonly companySignals: readonly string[];
  /** Targets that cannot be verified as the current company (matched case-insensitively). */
  readonly unverifiedScopeTerms: readonly string[];
  /** Request verbs; a shorter verb never matches inside a longer listed verb (查 vs 查詢). */
  readonly queryVerbs: readonly string[];
  readonly negationTerms: readonly string[];
  /** Optional verb directly after a negation term. */
  readonly negationVerbs: readonly string[];
  readonly exclusionSuffixes: readonly string[];
  /** Words that start a replacement clause, e.g. 而是 / 改查. */
  readonly clauseSwitchTerms: readonly string[];
  readonly timeModifiers: readonly string[];
  /** Words that may follow 「<target>的」 when the user names a query target. */
  readonly scopeAnchorTerms: readonly string[];
}

export interface CompanyScopePolicy {
  evaluate(input: Pick<QueryScopePolicyInput, 'query' | 'previousTurnScopeOutcome'>): QueryScopeDecision;
}

const MAX_QUERY_LENGTH = 4_000;
const CLAUSE_PUNCTUATION = '，,。；;！？!?';
const NON_PUNCTUATION = `[^${CLAUSE_PUNCTUATION}]`;

/** Compiles a Customer vocabulary into the deterministic, fail-closed company scope classifier. */
export function createCompanyScopePolicy(vocabulary: CompanyScopeVocabularyV1): CompanyScopePolicy {
  const v = vocabulary;
  const currentTerms = alt(v.currentCompanyPrefixes.flatMap((prefix) => v.currentCompanyNouns.map((noun) => prefix + noun)));
  const nouns = alt(v.companyNouns);
  const other = `(?:${alt(v.otherCompanyQualifiers)})(?:的)?(?:${nouns})`;
  const vague = `(?:${alt(v.vagueCompanyQualifiers)})(?:${nouns})`;
  const negationLead = `(?:${alt(v.negationTerms)})(?:要)?(?:${alt(v.negationVerbs)})?`;
  const verbs = verbAlternation(v.queryVerbs);

  const re = Object.freeze({
    current: new RegExp(`(?:${currentTerms})`, 'u'),
    currentAll: new RegExp(`(?:${currentTerms})`, 'gu'),
    other: new RegExp(other, 'u'),
    otherAll: new RegExp(other, 'gu'),
    vague: new RegExp(vague, 'u'),
    vagueAll: new RegExp(vague, 'gu'),
    company: new RegExp(`(?:${alt(v.companySignals)})`, 'iu'),
    negatedScopeOnly: new RegExp(`^${negationLead}(?:${alt([...v.otherCompanyQualifiers, ...v.currentCompanyPrefixes])})(?:的)?(?:${nouns})(?:的)?$`, 'u'),
    negatedCurrent: new RegExp(`^${negationLead}(?:${currentTerms})`, 'u'),
    // A possessive target before a scope anchor is a scope request, unlike politeness or word order.
    unspecifiedTarget: new RegExp(`(?:${verbs})(${NON_PUNCTUATION}{1,24})的(?=(?:${alt(v.scopeAnchorTerms)}))`, 'u'),
    prefixedScope: new RegExp(`(?:${verbs})(${NON_PUNCTUATION}{1,24}?)(?=(?:${alt(v.timeModifiers)}))`, 'u'),
    timeModifier: new RegExp(`^(?:${alt(v.timeModifiers)})$`, 'u'),
    unverifiedScope: new RegExp(`(?:${alt(v.unverifiedScopeTerms)})`, 'iu'),
    excludedCurrent: new RegExp(`(?:${currentTerms})(?:${alt(v.exclusionSuffixes)})`, 'u'),
    clauseSplit: new RegExp(`[${CLAUSE_PUNCTUATION}]|(?:${alt(v.clauseSwitchTerms)})`, 'u')
  });

  return Object.freeze({
    evaluate(input: Pick<QueryScopePolicyInput, 'query' | 'previousTurnScopeOutcome'>): QueryScopeDecision {
      const normalized = typeof input?.query === 'string' ? input.query.normalize('NFKC').toLocaleLowerCase('en-US') : '';
      if (normalized.length === 0 || normalized.length > MAX_QUERY_LENGTH) return decision('DENY', 'QUERY_SCOPE_POLICY_UNAVAILABLE');
      const clauses = normalized.split(re.clauseSplit).map((part) => part.trim()).filter(Boolean);
      let current = false;
      let otherCompany = false;
      let vagueCompany = false;
      let unverified = false;
      let unknownScope = false;
      let excludedCurrent = false;
      for (const clause of clauses) {
        const negated = re.negatedScopeOnly.test(clause);
        const isCurrent = re.current.test(clause);
        const isOther = re.other.test(clause);
        const isVague = re.vague.test(clause);
        const negatedCurrent = re.negatedCurrent.test(clause);
        excludedCurrent ||= negatedCurrent || re.excludedCurrent.test(clause);
        // Excluding another company does not request its data; excluding the
        // current company must never authorize the fixed current-company Tool.
        if (negated && isOther && !isCurrent && !isVague) continue;
        if (!re.company.test(clause)) {
          const target = re.unspecifiedTarget.exec(clause)?.[1]?.trim();
          const prefixedScope = re.prefixedScope.exec(clause)?.[1]?.trim();
          // A follow-up that names no target (e.g. a bare period change) inherits the current
          // company scope; only an explicitly named or unverifiable target is ambiguous.
          unknownScope ||= re.unverifiedScope.test(clause) || (target !== undefined && !re.timeModifier.test(target)) ||
            prefixedScope !== undefined;
          continue;
        }
        current ||= isCurrent && !negatedCurrent;
        otherCompany ||= isOther;
        vagueCompany ||= isVague;
        const remainingTargets = clause.replace(re.currentAll, '').replace(re.otherAll, '').replace(re.vagueAll, '');
        unverified ||= re.company.test(remainingTargets);
        unknownScope ||= re.unverifiedScope.test(clause) && !isOther;
      }
      if ((current && (otherCompany || vagueCompany || unverified)) || (otherCompany && vagueCompany)) {
        return decision('CLARIFY', 'QUERY_SCOPE_AMBIGUOUS');
      }
      if (otherCompany) return decision('DENY', 'QUERY_SCOPE_OUTSIDE_AUTHORIZED_SCOPE');
      if (excludedCurrent || vagueCompany || unknownScope) return decision('CLARIFY', 'QUERY_SCOPE_AMBIGUOUS');
      if (unverified) return decision('DENY', 'QUERY_SCOPE_TARGET_UNVERIFIED');
      // After a denied or ambiguous turn, a follow-up that does not name the current company
      // would answer with current-company data the user may read as the other target.
      if (input.previousTurnScopeOutcome !== undefined && !current) return decision('CLARIFY', 'QUERY_SCOPE_AMBIGUOUS');
      return decision('ALLOW', 'QUERY_SCOPE_VALIDATED');
    }
  });
}

function decision(outcome: QueryScopeDecision['outcome'], reason: NonNullable<QueryScopeDecision['reason']>): QueryScopeDecision {
  return Object.freeze({ outcome, reason });
}

function escapeRegExp(value: string): string {
  // Only syntax characters: identity escapes such as \- are invalid with the u flag.
  return value.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

/** Longest alternatives first so a longer term wins at the same position. */
function alt(terms: readonly string[]): string {
  return [...new Set(terms)].sort((left, right) => right.length - left.length || left.localeCompare(right))
    .map(escapeRegExp).join('|');
}

/**
 * A verb must not match as part of a longer listed verb: 查 is rejected before 詢 in 查詢,
 * and 詢 is rejected after 查, so 查詢 is always read as one verb.
 */
function verbAlternation(verbs: readonly string[]): string {
  const unique = [...new Set(verbs)];
  return unique.sort((left, right) => right.length - left.length || left.localeCompare(right)).map((verb) => {
    const before = unique.filter((other) => other !== verb && other.endsWith(verb)).map((other) => other.slice(0, -verb.length));
    const after = unique.filter((other) => other !== verb && other.startsWith(verb)).map((other) => other.slice(verb.length));
    return `${before.length ? `(?<!${alt(before)})` : ''}${escapeRegExp(verb)}${after.length ? `(?!${alt(after)})` : ''}`;
  }).join('|');
}
