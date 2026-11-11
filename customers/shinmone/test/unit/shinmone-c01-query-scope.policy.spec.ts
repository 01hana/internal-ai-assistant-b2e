import { loadQueryScopeRegistrationsFromEnv, QUERY_SCOPE_POLICY_PATHS_ENV } from '../../../../src/query-scope/query-scope-config';
import type { QueryScopePolicyInput } from '../../../../src/query-scope/query-scope.types';
import {
  SHINMONE_DEMO_QUERY_SCOPE_PATH,
  SHINMONE_LOCAL_QUERY_SCOPE_PATH,
  shinmoneQueryScopeRegistrations
} from '../support/shinmone-query-scope.fixture';

const localPolicy = shinmoneQueryScopeRegistrations(SHINMONE_LOCAL_QUERY_SCOPE_PATH)[0].policy!;
const demoPolicy = shinmoneQueryScopeRegistrations(SHINMONE_DEMO_QUERY_SCOPE_PATH)[0].policy!;

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
    // Follow-ups that name no target stay in the current company scope (product decision 2026-11-11).
    ['那這個月呢？', 'ALLOW', 'QUERY_SCOPE_VALIDATED'],
    ['那本月新增工單數呢？', 'ALLOW', 'QUERY_SCOPE_VALIDATED'],
    ['那別家公司呢？', 'DENY', 'QUERY_SCOPE_OUTSIDE_AUTHORIZED_SCOPE'],
    ['那那家公司呢？', 'CLARIFY', 'QUERY_SCOPE_AMBIGUOUS'],
    ['查某家公司的本月新增工單數', 'CLARIFY', 'QUERY_SCOPE_AMBIGUOUS'],
    ['查本公司和其他公司的本月新增工單數', 'CLARIFY', 'QUERY_SCOPE_AMBIGUOUS'],
    ['查本公司和乙公司的本月新增工單數', 'CLARIFY', 'QUERY_SCOPE_AMBIGUOUS'],
    ['查本公司以外的本月新增工單數', 'CLARIFY', 'QUERY_SCOPE_AMBIGUOUS'],
    ['不是查本公司，而是查其他公司的本月新增工單數', 'DENY', 'QUERY_SCOPE_OUTSIDE_AUTHORIZED_SCOPE'],
    ['不是查另一家公司也查乙公司的本月新增工單數', 'DENY', 'QUERY_SCOPE_OUTSIDE_AUTHORIZED_SCOPE']
  ])('classifies %s', (query, outcome, reason) => {
    expect(localPolicy.evaluate({ query } as QueryScopePolicyInput))
      .toEqual({ outcome, reason });
  });

  // 「查詢」「查看」 are complete verbs: the trailing character is not a query target.
  it.each([
    ['請查詢本月的新增工單數', 'ALLOW', 'QUERY_SCOPE_VALIDATED'],
    ['查詢今天新增幾張工單', 'ALLOW', 'QUERY_SCOPE_VALIDATED'],
    ['幫我查看這個月新增工單數', 'ALLOW', 'QUERY_SCOPE_VALIDATED'],
    ['查詢另一家公司的本月新增工單數', 'DENY', 'QUERY_SCOPE_OUTSIDE_AUTHORIZED_SCOPE'],
    ['查詢乙公司的本月新增工單數', 'DENY', 'QUERY_SCOPE_TARGET_UNVERIFIED'],
    ['查詢甲部門的本月新增工單數', 'CLARIFY', 'QUERY_SCOPE_AMBIGUOUS']
  ])('reads 查詢/查看 as one verb: %s', (query, outcome, reason) => {
    expect(localPolicy.evaluate({ query } as QueryScopePolicyInput)).toEqual({ outcome, reason });
  });

  it('keeps real Customer activation explicit and covers all existing C01 periods', () => {
    expect(loadQueryScopeRegistrationsFromEnv({})).toEqual([]);
    expect(loadQueryScopeRegistrationsFromEnv({ [QUERY_SCOPE_POLICY_PATHS_ENV]: JSON.stringify([SHINMONE_LOCAL_QUERY_SCOPE_PATH]) })
      .map(({ customerId, integrationId, hostApp, capabilityKey, toolKey }) => ({ customerId, integrationId, hostApp, capabilityKey, toolKey })))
      .toEqual(['today', 'weekly', 'monthly'].map((period) => ({
        customerId: 'customer-shinmone-scm-local', integrationId: 'shinmone-scm-assistant-local', hostApp: 'shinmone-scm',
        capabilityKey: 'work-orders.count', toolKey: `work-orders.${period}-new-count`
      })));
  });
});

// Prepared for the Demo deployment; not enabled until ASSISTANT_QUERY_SCOPE_POLICY_PATHS_JSON lists it.
describe('[CUSTOMER_POLICY] Shinmone KPIStats Demo query scope policy', () => {
  it('guards exactly the three Demo KPIStats bindings', () => {
    expect(shinmoneQueryScopeRegistrations(SHINMONE_DEMO_QUERY_SCOPE_PATH)
      .map(({ customerId, integrationId, hostApp, capabilityKey, bindingId, toolKey, toolVersion }) =>
        ({ customerId, integrationId, hostApp, capabilityKey, bindingId, toolKey, toolVersion })))
      .toEqual(['today', 'weekly', 'monthly'].map((period) => ({
        customerId: 'customer-shinmone', integrationId: 'shinmone-scm-assistant', hostApp: 'shinmone-scm',
        capabilityKey: 'shinmone.dashboard.kpistats.snapshot', bindingId: `shinmone.kpistats.snapshot.${period}`,
        toolKey: `shinmone.kpistats.snapshot.${period}`, toolVersion: '1.0.0'
      })));
  });

  it.each([
    ['今天新增多少張工單？', 'ALLOW', 'QUERY_SCOPE_VALIDATED'],
    ['本週完工工單有幾張？', 'ALLOW', 'QUERY_SCOPE_VALIDATED'],
    ['本月的完工率是多少？', 'ALLOW', 'QUERY_SCOPE_VALIDATED'],
    ['本週逾期工單有幾張？', 'ALLOW', 'QUERY_SCOPE_VALIDATED'],
    ['請查詢今日 Dashboard KPIStats 統計', 'ALLOW', 'QUERY_SCOPE_VALIDATED'],
    ['本月儀表板工單統計的六項指標', 'ALLOW', 'QUERY_SCOPE_VALIDATED'],
    ['其他廠商本月新增幾張工單？', 'DENY', 'QUERY_SCOPE_OUTSIDE_AUTHORIZED_SCOPE'],
    ['別家公司的完工率', 'DENY', 'QUERY_SCOPE_OUTSIDE_AUTHORIZED_SCOPE'],
    ['查乙公司的本月逾期工單', 'DENY', 'QUERY_SCOPE_TARGET_UNVERIFIED'],
    ['查甲部門的完工率', 'CLARIFY', 'QUERY_SCOPE_AMBIGUOUS'],
    ['那本週呢？', 'ALLOW', 'QUERY_SCOPE_VALIDATED'],
    ['那本月的完工率呢？', 'ALLOW', 'QUERY_SCOPE_VALIDATED'],
    ['那其他廠商呢？', 'DENY', 'QUERY_SCOPE_OUTSIDE_AUTHORIZED_SCOPE']
  ])('classifies %s', (query, outcome, reason) => {
    expect(demoPolicy.evaluate({ query } as QueryScopePolicyInput)).toEqual({ outcome, reason });
  });
});
