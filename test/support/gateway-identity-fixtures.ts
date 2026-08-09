/**
 * Synthetic Feature 003 fixtures. They intentionally share every lower-level
 * upstream identity attribute while keeping the explicit registry binding
 * authority distinct. They never contain a JWT, key, or credential.
 */
import { GATEWAY_INTEGRATION_BINDING_SEEDS } from '../../scripts/gateway-identity-fixtures';

const [customerA, customerB] = GATEWAY_INTEGRATION_BINDING_SEEDS;

export const GATEWAY_IDENTITY_FIXTURES = Object.freeze({
  customerA: Object.freeze({ customerId: customerA.customerId, integrationId: customerA.integrationId }),
  customerB: Object.freeze({ customerId: customerB.customerId, integrationId: customerB.integrationId }),
  shared: Object.freeze({
    organizationId: 'org-shared',
    actorId: 'actor-shared',
    hostApp: customerA.allowedHostApp,
    roles: Object.freeze(['planner']),
    permissionScopes: Object.freeze(['orders:read'])
  })
});

export type GatewayIdentityFixture = typeof GATEWAY_IDENTITY_FIXTURES;
