import { CanonicalIdentityClaims, TestJwtFixture } from './internal-identity-jwt.helper';

export const CUSTOMER_TOOL_PHASE6 = Object.freeze({
  toolDefinitionId: 'tool-definition-orders-001',
  toolName: 'mock.orders.status.lookup',
  idempotencyKey: 'shared-tool-idempotency-key',
  policies: Object.freeze({
    customerA: Object.freeze({ customerId: 'customer-a', enabled: true, requiredRoles: [], requiredPermissionScopes: [] }),
    customerB: Object.freeze({ customerId: 'customer-b', enabled: false, requiredRoles: [], requiredPermissionScopes: [] })
  })
});

export function claimsForToolScenario(
  fixture: TestJwtFixture,
  customer: 'customerA' | 'customerB',
  overrides: Partial<CanonicalIdentityClaims> = {}
): CanonicalIdentityClaims {
  return { ...fixture.canonicalClaims[customer], ...overrides };
}
