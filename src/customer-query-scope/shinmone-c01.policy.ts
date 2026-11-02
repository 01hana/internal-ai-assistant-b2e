import type { QueryScopeDecision, QueryScopePolicyInput, QueryScopeRegistration } from '../query-scope/query-scope.types';

const CURRENT = /(?:本公司|我們公司|我方公司|目前公司|當前公司|登入公司|自己公司)/u;
const CURRENT_ALL = /(?:本公司|我們公司|我方公司|目前公司|當前公司|登入公司|自己公司)/gu;
const OTHER = /(?:另一家|其他|別家|別的|不同|非本|非我方)(?:的)?(?:公司|企業|廠商)/u;
const OTHER_ALL = /(?:另一家|其他|別家|別的|不同|非本|非我方)(?:的)?(?:公司|企業|廠商)/gu;
const VAGUE = /(?:某家|某個|哪家|那家|任一家|指定(?:的)?)(?:公司|企業|廠商)/u;
const VAGUE_ALL = /(?:某家|某個|哪家|那家|任一家|指定(?:的)?)(?:公司|企業|廠商)/gu;
const COMPANY = /(?:公司|企業|廠商|供應商|vendor|company)/iu;
const NEGATED_SCOPE_ONLY = /^(?:不是|並非|不要|不查|無須查|排除)(?:要)?(?:查|看|詢)?(?:另一家|其他|別家|別的|不同|非本|非我方|本|我們|目前|當前|登入|自己|我方)(?:的)?(?:公司|企業|廠商)(?:的)?$/u;
const NEGATED_CURRENT = /^(?:不是|並非|不要|不查|無須查|排除)(?:要)?(?:查|看|詢)?(?:本公司|我們公司|我方公司|目前公司|當前公司|登入公司|自己公司)/u;
// A possessive target before the C01 metric is a scope request, unlike politeness or word order.
const UNSPECIFIED_TARGET = /(?:查|看|詢|統計|算|列出|提供)([^，,。；;！？!?]{1,24})的(?=(?:本月|本週|今天|今日|這個月|這週|新增|新開|工單))/u;
const PREFIXED_SCOPE = /(?:查|看|詢|統計|算|列出|提供)([^，,。；;！？!?]{1,24}?)(?=(?:本月|本週|今天|今日|這個月|這週|這個禮拜))/u;
const TIME_MODIFIER = /^(?:本月|本週|今天|今日|這個月|這週|這個禮拜)$/u;
const UNVERIFIED_SCOPE = /(?:競品|競爭對手|外部|客戶|合作夥伴|供應商|vendor|company)/iu;
const CONTEXT_DEPENDENT_SCOPE = /^(?:那|那麼|同樣|剛才|剛剛|上述|前述|該)/u;
const EXCLUDED_CURRENT = /(?:本公司|我們公司|我方公司|目前公司|當前公司|登入公司|自己公司)(?:以外|之外|除外)/u;

/** Customer-owned, conservative classification; never produces authorization for a different company. */
export const shinmoneC01QueryScopePolicy = Object.freeze({
  evaluate(input: QueryScopePolicyInput): QueryScopeDecision {
    const normalized = input.query.normalize('NFKC').toLocaleLowerCase('en-US');
    if (normalized.length === 0 || normalized.length > 4_000) return decision('DENY', 'QUERY_SCOPE_POLICY_UNAVAILABLE');
    const clauses = normalized.split(/[，,。；;！？!?]|(?:而是|改為|改查|轉查)/u).map((part) => part.trim()).filter(Boolean);
    let current = false;
    let other = false;
    let vague = false;
    let unverified = false;
    let unknownScope = false;
    let excludedCurrent = false;
    for (const clause of clauses) {
      const negated = NEGATED_SCOPE_ONLY.test(clause);
      const isCurrent = CURRENT.test(clause);
      const isOther = OTHER.test(clause);
      const isVague = VAGUE.test(clause);
      const negatedCurrent = NEGATED_CURRENT.test(clause);
      excludedCurrent ||= negatedCurrent || EXCLUDED_CURRENT.test(clause);
      // Excluding another company does not request its data; excluding the
      // current company must never authorize the fixed current-company Tool.
      if (negated && isOther && !isCurrent && !isVague) continue;
      if (!COMPANY.test(clause)) {
        const target = UNSPECIFIED_TARGET.exec(clause)?.[1]?.trim();
        const prefixedScope = PREFIXED_SCOPE.exec(clause)?.[1]?.trim();
        unknownScope ||= UNVERIFIED_SCOPE.test(clause) || (target !== undefined && !TIME_MODIFIER.test(target)) ||
          prefixedScope !== undefined || CONTEXT_DEPENDENT_SCOPE.test(clause);
        continue;
      }
      current ||= isCurrent && !negatedCurrent;
      other ||= isOther;
      vague ||= isVague;
      const remainingTargets = clause.replace(CURRENT_ALL, '').replace(OTHER_ALL, '').replace(VAGUE_ALL, '');
      unverified ||= COMPANY.test(remainingTargets);
      unknownScope ||= UNVERIFIED_SCOPE.test(clause) && !isOther;
    }
    if ((current && (other || vague || unverified)) || (other && vague)) {
      return decision('CLARIFY', 'QUERY_SCOPE_AMBIGUOUS');
    }
    if (other) return decision('DENY', 'QUERY_SCOPE_OUTSIDE_AUTHORIZED_SCOPE');
    if (excludedCurrent || vague || unknownScope) return decision('CLARIFY', 'QUERY_SCOPE_AMBIGUOUS');
    if (unverified) return decision('DENY', 'QUERY_SCOPE_TARGET_UNVERIFIED');
    return decision('ALLOW', 'QUERY_SCOPE_VALIDATED');
  }
});

function decision(outcome: QueryScopeDecision['outcome'], reason: NonNullable<QueryScopeDecision['reason']>): QueryScopeDecision {
  return Object.freeze({ outcome, reason });
}

export function createShinmoneC01QueryScopeRegistration(scope: Readonly<{
  customerId: string; integrationId: string; hostApp: string;
}>, period: 'today' | 'weekly' | 'monthly' = 'monthly'): QueryScopeRegistration {
  const toolKey = `work-orders.${period}-new-count`;
  return Object.freeze({ ...scope, capabilityKey: 'work-orders.count',
    bindingId: toolKey, toolKey,
    toolVersion: '1.0.0', policy: shinmoneC01QueryScopePolicy });
}
