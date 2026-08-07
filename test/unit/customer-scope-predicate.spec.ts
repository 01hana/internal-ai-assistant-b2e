import { resolve } from 'node:path';
import { requireTargetModule } from '../support/dynamic-target-module.helper';

describe('Customer-first predicate helpers (T018 contract)', () => {
  const scopeA = createScope('customer-a');
  const scopeB = createScope('customer-b');

  it('qualifies IDs, lists, relations, and unique keys with the canonical Customer', () => {
    const helpers = loadHelpers();
    expect(helpers.customerScopedIdPredicate(scopeA, { id: 'resource-001' })).toEqual({ customerId: 'customer-a', id: 'resource-001' });
    expect(helpers.customerScopedListPredicate(scopeA, { status: 'active' })).toEqual({ customerId: 'customer-a', status: 'active' });
    expect(helpers.customerScopedListPredicate(scopeA)).toEqual({ customerId: 'customer-a' });
    expect(helpers.customerScopedRelationPredicate(scopeA, { sessionId: 'session-001' })).toEqual({ customerId: 'customer-a', sessionId: 'session-001' });
    expect(helpers.customerScopedUniquePredicate(scopeA, { sourceKey: 'shared-source', version: '1' })).toEqual({
      customerId: 'customer-a', sourceKey: 'shared-source', version: '1'
    });
  });

  it('keeps identical lower-level keys in separate Customer namespaces', () => {
    const { customerScopedUniquePredicate } = loadHelpers();
    const unique = { sourceKey: 'shared-source', version: '1' };
    expect(customerScopedUniquePredicate(scopeA, unique)).toEqual({ customerId: 'customer-a', ...unique });
    expect(customerScopedUniquePredicate(scopeB, unique)).toEqual({ customerId: 'customer-b', ...unique });
  });

  it('rejects caller customerId overrides and malformed bare constraints', () => {
    const helpers = loadHelpers();
    expect(() => helpers.customerScopedListPredicate(scopeA, { customerId: 'customer-b' } as never)).toThrow(/customer/i);
    expect(() => helpers.customerScopedIdPredicate(scopeA, { id: ' ' })).toThrow();
    expect(() => helpers.customerScopedRelationPredicate(scopeA, {})).toThrow();
    expect(() => helpers.customerScopedUniquePredicate(scopeA, {})).toThrow();
    expect(() => helpers.customerScopedListPredicate(undefined as never)).toThrow();
  });

  it('returns frozen new predicates and exposes no unscoped fallback', () => {
    const helpers = loadHelpers();
    const input = { status: 'active' };
    const predicate = helpers.customerScopedListPredicate(scopeA, input);
    input.status = 'closed';
    expect(predicate).toEqual({ customerId: 'customer-a', status: 'active' });
    expect(Object.isFrozen(predicate)).toBe(true);
    expect(helpers).not.toHaveProperty('byId');
    expect(helpers).not.toHaveProperty('findByGlobalId');
    expect(helpers).not.toHaveProperty('globalIdPredicate');
    expect(helpers).not.toHaveProperty('unscopedWhere');
  });
});

type PredicateHelpers = {
  customerScopedIdPredicate(scope: Record<string, unknown>, input: { id: string }): Record<string, unknown>;
  customerScopedListPredicate(scope: Record<string, unknown>, filters?: Record<string, unknown>): Record<string, unknown>;
  customerScopedRelationPredicate(scope: Record<string, unknown>, relation: Record<string, unknown>): Record<string, unknown>;
  customerScopedUniquePredicate(scope: Record<string, unknown>, unique: Record<string, unknown>): Record<string, unknown>;
};

function loadHelpers(): PredicateHelpers {
  const modulePath = resolve(__dirname, '../../src/prisma/customer-scope.predicate');
  const target = requireTargetModule(modulePath, 'T020 not implemented: CustomerScope predicates are unavailable to T018 tests.');
  for (const name of ['customerScopedIdPredicate', 'customerScopedListPredicate', 'customerScopedRelationPredicate', 'customerScopedUniquePredicate']) {
    if (typeof target[name] !== 'function') {
      throw new Error(`Expected export ${name} is unavailable.`);
    }
  }
  return target as unknown as PredicateHelpers;
}

function createScope(customerId: string): Record<string, unknown> {
  return Object.freeze({
    customerId,
    integrationId: 'integration-erp',
    organizationId: 'org-shared',
    hostApp: 'erp',
    actorId: 'actor-shared',
    roles: Object.freeze(['planner']),
    permissionScopes: Object.freeze(['orders:read'])
  });
}
