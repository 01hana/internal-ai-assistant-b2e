import { resolve } from 'node:path';
import { RequestIdentityContext } from '../../src/identity/identity-context.types';
import { createInternalIdentityJwtFixture } from '../support/internal-identity-jwt.helper';
import { requireTargetModule } from '../support/dynamic-target-module.helper';

describe('CustomerScope factory (T017 contract)', () => {
  const fixture = createInternalIdentityJwtFixture();

  it('maps only canonical identity fields and keeps Customer A/B distinct', () => {
    const createScope = loadFactory();
    const scopeA = createScope(createContext(fixture.canonicalClaims.customerA));
    const scopeB = createScope(createContext(fixture.canonicalClaims.customerB));

    expect(scopeA).toMatchObject({
      customerId: 'customer-a',
      integrationId: 'integration-erp',
      organizationId: 'org-shared',
      hostApp: 'erp',
      actorId: 'actor-shared',
      roles: ['planner'],
      permissionScopes: ['orders:read']
    });
    expect(scopeB).toMatchObject({ customerId: 'customer-b' });
    expect(scopeA).not.toEqual(scopeB);
  });

  it('does not accept payload or public-header authority', () => {
    const createScope = loadFactory();
    const context = createContext(fixture.canonicalClaims.customerA);
    const payload = { customerId: 'customer-b', integrationId: 'attacker-integration', organizationId: 'attacker-org' };
    const publicHeaders = { 'x-customer-id': 'customer-b', 'x-organization-id': 'attacker-org', 'x-host-app': 'attacker-host' };

    const scope = createScope(context, payload, publicHeaders);
    expect(createScope).toHaveLength(1);
    expect(scope).toMatchObject({ customerId: 'customer-a', integrationId: 'integration-erp', organizationId: 'org-shared' });
    expect(JSON.stringify(scope)).not.toContain('attacker');
  });

  it('keeps request and auth traceability outside the scope', () => {
    const scope = loadFactory()(createContext(fixture.canonicalClaims.customerA, { requestId: 'customer-b' }));
    expect(scope).not.toHaveProperty('requestId');
    expect(scope).not.toHaveProperty('tokenId');
    expect(scope).not.toHaveProperty('gatewayIssuer');
    expect(scope).not.toHaveProperty('authorization');
    expect(scope).not.toHaveProperty('rawToken');
    expect(scope).not.toHaveProperty('claims');
  });

  it('creates an immutable authorization snapshot and permits empty arrays', () => {
    const context = createContext({ ...fixture.canonicalClaims.customerA, roles: [], permission_scopes: [] });
    const scope = loadFactory()(context);
    context.actor.roles.push('mutated');
    context.actor.permissionScopes.push('mutated:scope');

    expect(scope.roles).toEqual([]);
    expect(scope.permissionScopes).toEqual([]);
    expect(Object.isFrozen(scope)).toBe(true);
    expect(Object.isFrozen(scope.roles)).toBe(true);
    expect(Object.isFrozen(scope.permissionScopes)).toBe(true);
    expect(() => (scope as unknown as { customerId: string }).customerId = 'customer-b').toThrow();
    expect(() => (scope.roles as string[]).push('mutated')).toThrow();
  });
});

type Factory = (context: RequestIdentityContext, ...ignored: unknown[]) => Record<string, unknown> & {
  roles: readonly string[];
  permissionScopes: readonly string[];
};

function loadFactory(): Factory {
  const modulePath = resolve(__dirname, '../../src/identity/customer-scope.factory');
  const target = requireTargetModule(modulePath, 'T019 not implemented: CustomerScope factory is unavailable to T017 tests.');
  const factory = target.createCustomerScopeFromIdentityContext;
  if (typeof factory !== 'function') {
    throw new Error('Expected export createCustomerScopeFromIdentityContext is unavailable.');
  }
  return factory as Factory;
}

function createContext(
  claims: { customer_id: string; integration_id: string; sub: string; org_id: string; host_app: string; roles: string[]; permission_scopes: string[]; jti: string },
  overrides: Partial<RequestIdentityContext> = {}
): RequestIdentityContext {
  return {
    requestId: 'req-scope-test',
    customer: { customerId: claims.customer_id, integrationId: claims.integration_id },
    organization: { organizationId: claims.org_id },
    hostApp: { hostApp: claims.host_app },
    actor: { actorId: claims.sub, roles: [...claims.roles], permissionScopes: [...claims.permission_scopes] },
    auth: { tokenId: claims.jti, gatewayIssuer: 'https://gateway.test.internal' },
    ...overrides
  };
}
