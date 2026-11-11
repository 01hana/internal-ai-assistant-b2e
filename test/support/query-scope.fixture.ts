import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createQueryScopeRegistrations, parseQueryScopePolicyConfigJsonV1 } from '../../src/query-scope/query-scope-config';
import type { QueryScopeRegistration } from '../../src/query-scope/query-scope.types';

export const SYNTHETIC_QUERY_SCOPE_POLICY_PATH = resolve('test/fixtures/query-scope/synthetic-company-scope.v1.json');

/** Synthetic Customer A current-company registration built through the generic configuration path. */
export function syntheticQueryScopeRegistration(
  scope: Readonly<{ customerId: string; integrationId: string; hostApp: string }> = {
    customerId: 'customer-a', integrationId: 'integration-erp', hostApp: 'erp'
  },
  period: 'today' | 'weekly' | 'monthly' = 'monthly'
): QueryScopeRegistration {
  const registrations = createQueryScopeRegistrations(parseQueryScopePolicyConfigJsonV1(readFileSync(SYNTHETIC_QUERY_SCOPE_POLICY_PATH)));
  const registration = registrations.find((entry) => entry.toolKey === `work-orders.${period}-new-count`);
  if (!registration) throw new Error('SYNTHETIC_QUERY_SCOPE_FIXTURE_MISSING');
  return Object.freeze({ ...registration, ...scope });
}
