import { createCustomerScopeFromIdentityContext } from '../../src/identity/customer-scope.factory';
import { assertCustomerScopeMatchesIdentityContext } from '../../src/identity/customer-scope-consistency';

describe('organization boundary integration baseline', () => {
  it('fails closed when resource organization or host app differs from request identity', () => {
    const identity = {
      requestId: 'req-boundary',
      customer: { customerId: 'customer-a', integrationId: 'integration-erp' },
      organization: { organizationId: 'org-001' },
      hostApp: { hostApp: 'erp' },
      actor: { actorId: 'actor-001', roles: ['planner'], permissionScopes: ['orders:read'] },
      auth: { tokenId: 'jwt-boundary', gatewayIssuer: 'https://gateway.test.internal' }
    };
    const scope = createCustomerScopeFromIdentityContext(identity);

    expect(() => assertCustomerScopeMatchesIdentityContext(scope, { ...identity, organization: { organizationId: 'org-002' } })).toThrow(/not found/i);
    expect(() => assertCustomerScopeMatchesIdentityContext(scope, { ...identity, hostApp: { hostApp: 'wms' } })).toThrow(/not found/i);
  });
});
