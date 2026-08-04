import { createCustomerScopeFromIdentityContext } from '../../src/identity/customer-scope.factory';
import { RequestIdentityContext } from '../../src/identity/identity-context.types';
import { CustomerScope } from '../../src/identity/customer-scope.types';
import {
  CanonicalIdentityClaims,
  createInternalIdentityJwtFixture,
  TestJwtFixture
} from './internal-identity-jwt.helper';

export type KnowledgeAccessPolicyFixture = Readonly<{
  visibility: 'CUSTOMER' | 'ORGANIZATION';
  organizationIds: readonly string[];
  requiredPermissionScopes: readonly string[];
}>;

export type CustomerScopeFixtureCustomer = Readonly<{
  root: Readonly<{ id: string }>;
  integrationId: string;
}>;

export type CustomerScopeFixtureSet = Readonly<{
  shared: Readonly<{
    organizationId: string;
    actorId: string;
    hostApp: string;
    sourceKey: string;
    sourceVersion: string;
    idempotencyKey: string;
  }>;
  customerA: CustomerScopeFixtureCustomer;
  customerB: CustomerScopeFixtureCustomer;
  knowledgePolicies: Readonly<{
    customer: KnowledgeAccessPolicyFixture;
    organization: KnowledgeAccessPolicyFixture;
  }>;
}>;

const canonicalClaimsFixture = createInternalIdentityJwtFixture();

export const CUSTOMER_SCOPE_FIXTURES: CustomerScopeFixtureSet = deepFreeze({
  shared: {
    organizationId: canonicalClaimsFixture.canonicalClaims.customerA.org_id,
    actorId: canonicalClaimsFixture.canonicalClaims.customerA.sub,
    hostApp: canonicalClaimsFixture.canonicalClaims.customerA.host_app,
    sourceKey: 'shared-source',
    sourceVersion: '1',
    idempotencyKey: 'shared-idempotency-key'
  },
  customerA: {
    root: { id: canonicalClaimsFixture.canonicalClaims.customerA.customer_id },
    integrationId: canonicalClaimsFixture.canonicalClaims.customerA.integration_id
  },
  customerB: {
    root: { id: canonicalClaimsFixture.canonicalClaims.customerB.customer_id },
    integrationId: canonicalClaimsFixture.canonicalClaims.customerB.integration_id
  },
  knowledgePolicies: {
    customer: {
      visibility: 'CUSTOMER',
      organizationIds: [],
      requiredPermissionScopes: []
    },
    organization: {
      visibility: 'ORGANIZATION',
      organizationIds: [canonicalClaimsFixture.canonicalClaims.customerA.org_id],
      requiredPermissionScopes: ['orders:read']
    }
  }
});

export function createCustomerScopeFixtureIdentityContext(
  customer: CustomerScopeFixtureCustomer
): RequestIdentityContext {
  const claims = canonicalClaimsForCustomer(customer);
  return {
    requestId: 'req-customer-scope-fixture',
    customer: {
      customerId: claims.customer_id,
      integrationId: claims.integration_id
    },
    organization: { organizationId: claims.org_id },
    hostApp: { hostApp: claims.host_app },
    actor: {
      actorId: claims.sub,
      roles: [...claims.roles],
      permissionScopes: [...claims.permission_scopes]
    },
    auth: {
      tokenId: claims.jti,
      gatewayIssuer: 'https://gateway.test.internal'
    }
  };
}

export function createCustomerScopeFixtureScope(customer: CustomerScopeFixtureCustomer): CustomerScope {
  return createCustomerScopeFromIdentityContext(createCustomerScopeFixtureIdentityContext(customer));
}

/**
 * Returns canonical claims input for the existing test JWT signer. It never
 * exposes a token, Authorization header, JWKS, or signing material.
 */
export function createCustomerScopeFixtureJwtInput(
  customer: CustomerScopeFixtureCustomer
): Readonly<{ claims: CanonicalIdentityClaims }> {
  return deepFreeze({ claims: canonicalClaimsForCustomer(customer) });
}

function canonicalClaimsForCustomer(customer: CustomerScopeFixtureCustomer): CanonicalIdentityClaims {
  const claims =
    customer.root.id === CUSTOMER_SCOPE_FIXTURES.customerA.root.id
      ? canonicalClaimsFixture.canonicalClaims.customerA
      : customer.root.id === CUSTOMER_SCOPE_FIXTURES.customerB.root.id
        ? canonicalClaimsFixture.canonicalClaims.customerB
        : undefined;

  if (!claims || customer.integrationId !== claims.integration_id) {
    throw new Error('CustomerScope fixture customer must be Customer A or Customer B.');
  }

  return deepFreeze({
    ...claims,
    roles: [...claims.roles],
    permission_scopes: [...claims.permission_scopes]
  });
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }
  return value;
}
