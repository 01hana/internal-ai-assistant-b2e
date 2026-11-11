import { shinmoneC01QueryScopePolicy } from '../../../../src/customer-query-scope/shinmone-c01.policy';
import { customerQueryScopeRegistrations } from '../../../../src/customer-query-scope/registrations';
import type { QueryScopePolicyInput } from '../../../../src/query-scope/query-scope.types';

// CUSTOMER_POLICY: deterministic Customer-owned semantics; not real company authorization proof.
describe('[CUSTOMER_POLICY] Shinmone C01 query scope policy', () => {
  it.each([
    ['這個月新增幾張工單？', 'ALLOW', 'QUERY_SCOPE_VALIDATED'],
    ['本月新增工單數', 'ALLOW', 'QUERY_SCOPE_VALIDATED'],
    ['今天新增工單數', 'ALLOW', 'QUERY_SCOPE_VALIDATED'],
    ['請問本月新增多少工單？', 'ALLOW', 'QUERY_SCOPE_VALIDATED'],
    ['幫我查這個月新增幾張工單', 'ALLOW', 'QUERY_SCOPE_VALIDATED'],
    ['我想知道本月新增幾張工單', 'ALLOW', 'QUERY_SCOPE_VALIDATED'],
    ['請查本月的新增工單數', 'ALLOW', 'QUERY_SCOPE_VALIDATED'],
    ['本公司這個月新增多少工單？', 'ALLOW', 'QUERY_SCOPE_VALIDATED'],
    ['不是查另一家公司，請查本公司這個月新增幾張工單？', 'ALLOW', 'QUERY_SCOPE_VALIDATED'],
    ['不要查本公司，查這個月新增幾張工單', 'CLARIFY', 'QUERY_SCOPE_AMBIGUOUS'],
    ['不是查本公司，而是查這個月新增幾張工單', 'CLARIFY', 'QUERY_SCOPE_AMBIGUOUS'],
    ['不查本公司，查今天新增幾張工單', 'CLARIFY', 'QUERY_SCOPE_AMBIGUOUS'],
    ['查另一家公司的本月新增工單數', 'DENY', 'QUERY_SCOPE_OUTSIDE_AUTHORIZED_SCOPE'],
    ['查其他企業的本月新增工單數', 'DENY', 'QUERY_SCOPE_OUTSIDE_AUTHORIZED_SCOPE'],
    ['查乙公司的本月新增工單數', 'DENY', 'QUERY_SCOPE_TARGET_UNVERIFIED'],
    ['查關係企業的本月新增工單數', 'DENY', 'QUERY_SCOPE_TARGET_UNVERIFIED'],
    ['查競品的本月新增工單數', 'CLARIFY', 'QUERY_SCOPE_AMBIGUOUS'],
    ['查甲部門的本月新增工單數', 'CLARIFY', 'QUERY_SCOPE_AMBIGUOUS'],
    ['查甲部門本月新增工單數', 'CLARIFY', 'QUERY_SCOPE_AMBIGUOUS'],
    ['查海外本月新增工單數', 'CLARIFY', 'QUERY_SCOPE_AMBIGUOUS'],
    ['那這個月呢？', 'CLARIFY', 'QUERY_SCOPE_AMBIGUOUS'],
    ['那本月新增工單數呢？', 'CLARIFY', 'QUERY_SCOPE_AMBIGUOUS'],
    ['查某家公司的本月新增工單數', 'CLARIFY', 'QUERY_SCOPE_AMBIGUOUS'],
    ['查本公司和其他公司的本月新增工單數', 'CLARIFY', 'QUERY_SCOPE_AMBIGUOUS'],
    ['查本公司和乙公司的本月新增工單數', 'CLARIFY', 'QUERY_SCOPE_AMBIGUOUS'],
    ['查本公司以外的本月新增工單數', 'CLARIFY', 'QUERY_SCOPE_AMBIGUOUS'],
    ['不是查本公司，而是查其他公司的本月新增工單數', 'DENY', 'QUERY_SCOPE_OUTSIDE_AUTHORIZED_SCOPE'],
    ['不是查另一家公司也查乙公司的本月新增工單數', 'DENY', 'QUERY_SCOPE_OUTSIDE_AUTHORIZED_SCOPE']
  ])('classifies %s', (query, outcome, reason) => {
    expect(shinmoneC01QueryScopePolicy.evaluate({ query } as QueryScopePolicyInput))
      .toEqual({ outcome, reason });
  });

  it('keeps real Customer activation explicit and covers all existing C01 periods', () => {
    expect(customerQueryScopeRegistrations({})).toEqual([]);
    expect(customerQueryScopeRegistrations({ SHINMONE_C01_QUERY_SCOPE_POLICY_ENABLED: 'true' })
      .map((entry) => entry.toolKey)).toEqual([
        'work-orders.today-new-count', 'work-orders.weekly-new-count', 'work-orders.monthly-new-count'
      ]);
  });
});
