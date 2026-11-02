import type { QueryScopeRegistration } from '../query-scope/query-scope.types';
import { createShinmoneC01QueryScopeRegistration } from './shinmone-c01.policy';

/** Explicit opt-in only; the real Customer path remains disabled by default. */
export function customerQueryScopeRegistrations(env: NodeJS.ProcessEnv): readonly QueryScopeRegistration[] {
  if (env.SHINMONE_C01_QUERY_SCOPE_POLICY_ENABLED !== 'true') return Object.freeze([]);
  const scope = { customerId: 'customer-shinmone-scm-local',
    integrationId: 'shinmone-scm-assistant-local', hostApp: 'shinmone-scm' };
  return Object.freeze((['today', 'weekly', 'monthly'] as const)
    .map((period) => createShinmoneC01QueryScopeRegistration(scope, period)));
}
