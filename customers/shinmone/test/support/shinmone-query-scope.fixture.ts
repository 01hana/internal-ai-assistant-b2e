import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createQueryScopeRegistrations, parseQueryScopePolicyConfigJsonV1 } from '../../../../src/query-scope/query-scope-config';
import type { QueryScopeRegistration } from '../../../../src/query-scope/query-scope.types';

export const SHINMONE_LOCAL_QUERY_SCOPE_PATH = resolve('customers/shinmone/query-scope/company-scope.local.v1.json');
export const SHINMONE_DEMO_QUERY_SCOPE_PATH = resolve('customers/shinmone/query-scope/company-scope.demo.v1.json');

export function shinmoneQueryScopeRegistrations(path: string): readonly QueryScopeRegistration[] {
  return createQueryScopeRegistrations(parseQueryScopePolicyConfigJsonV1(readFileSync(path)));
}

/** Shinmone local C01 policy re-scoped to a synthetic test Customer (replaces createShinmoneC01QueryScopeRegistration). */
export function shinmoneC01QueryScopeRegistration(
  scope: Readonly<{ customerId: string; integrationId: string; hostApp: string }>,
  period: 'today' | 'weekly' | 'monthly' = 'monthly'
): QueryScopeRegistration {
  const registration = shinmoneQueryScopeRegistrations(SHINMONE_LOCAL_QUERY_SCOPE_PATH)
    .find((entry) => entry.toolKey === `work-orders.${period}-new-count`);
  if (!registration) throw new Error('SHINMONE_QUERY_SCOPE_FIXTURE_MISSING');
  return Object.freeze({ ...registration, ...scope });
}
