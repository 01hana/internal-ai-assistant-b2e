import { assertSafeTestDatabaseReset } from '../../scripts/test-db-safety';
import { Prisma } from '../../src/generated/prisma/client';
import { createPrismaClient } from '../../src/prisma/prisma-client.factory';
import {
  CUSTOMER_SCOPE_FIXTURES,
  createCustomerScopeFixtureIdentityContext,
  createCustomerScopeFixtureJwtInput,
  createCustomerScopeFixtureScope
} from '../support/customer-scope-fixtures';
import { createInternalIdentityJwtFixture } from '../support/internal-identity-jwt.helper';

describe('Customer A/B deterministic fixture contract (T021)', () => {
  const { customerA, customerB, knowledgePolicies, shared } = CUSTOMER_SCOPE_FIXTURES;

  it('keeps Customer as the only distinct ownership boundary while lower-level identity values match', () => {
    expect(customerA.root.id).toBe('customer-a');
    expect(customerB.root.id).toBe('customer-b');
    expect(customerA.root.id).not.toBe(customerB.root.id);
    expect(shared).toMatchObject({
      organizationId: 'org-shared',
      actorId: 'actor-shared',
      hostApp: 'erp',
      sourceKey: 'shared-source',
      sourceVersion: '1',
      idempotencyKey: 'shared-idempotency-key'
    });
  });

  it('uses Customer.id as the only Customer-root identifier without lifecycle assumptions', () => {
    for (const customer of [customerA, customerB]) {
      expect(customer.root).toEqual({ id: customer.root.id });
      expect(customer.root).not.toHaveProperty('customerId');
      for (const lifecycleField of ['status', 'isActive', 'disabledAt', 'deletedAt', 'retentionPolicy', 'lifecycleState']) {
        expect(customer.root).not.toHaveProperty(lifecycleField);
      }
    }
  });

  it('provides valid, HostApp-independent knowledge-policy fixture values', () => {
    expect(knowledgePolicies.customer).toEqual({
      visibility: 'CUSTOMER',
      organizationIds: [],
      requiredPermissionScopes: []
    });
    expect(knowledgePolicies.organization).toEqual({
      visibility: 'ORGANIZATION',
      organizationIds: ['org-shared'],
      requiredPermissionScopes: ['orders:read']
    });
    expect(knowledgePolicies.customer).not.toHaveProperty('hostApp');
    expect(knowledgePolicies.organization).not.toHaveProperty('hostApp');
    for (const policy of Object.values(knowledgePolicies)) {
      for (const value of [...policy.organizationIds, ...policy.requiredPermissionScopes]) {
        expect(value.trim()).not.toHaveLength(0);
      }
    }
  });

  it('is an immutable snapshot, including nested roots, policies, and arrays', () => {
    expect(Object.isFrozen(CUSTOMER_SCOPE_FIXTURES)).toBe(true);
    expect(Object.isFrozen(shared)).toBe(true);
    expect(Object.isFrozen(customerA)).toBe(true);
    expect(Object.isFrozen(customerA.root)).toBe(true);
    expect(Object.isFrozen(knowledgePolicies.customer)).toBe(true);
    expect(Object.isFrozen(knowledgePolicies.customer.organizationIds)).toBe(true);
    expect(Object.isFrozen(knowledgePolicies.organization.requiredPermissionScopes)).toBe(true);
    expect(() => (customerA.root as { id: string }).id = 'mutated').toThrow();
    expect(() => (knowledgePolicies.organization.organizationIds as string[]).push('mutated')).toThrow();
  });

  it('reuses the internal JWT fixture claims to build canonical contexts, scopes, and signer input', () => {
    const contextA = createCustomerScopeFixtureIdentityContext(customerA);
    const contextB = createCustomerScopeFixtureIdentityContext(customerB);
    const scopeA = createCustomerScopeFixtureScope(customerA);
    const scopeB = createCustomerScopeFixtureScope(customerB);
    const signerInputA = createCustomerScopeFixtureJwtInput(customerA);
    const signerInputB = createCustomerScopeFixtureJwtInput(customerB);
    const jwtFixture = createInternalIdentityJwtFixture();

    expect(contextA.customer.customerId).toBe(customerA.root.id);
    expect(contextB.customer.customerId).toBe(customerB.root.id);
    expect(contextA.organization.organizationId).toBe(contextB.organization.organizationId);
    expect(contextA.actor.actorId).toBe(contextB.actor.actorId);
    expect(contextA.hostApp.hostApp).toBe(contextB.hostApp.hostApp);
    expect(scopeA).not.toEqual(scopeB);
    expect(scopeA.customerId).toBe('customer-a');
    expect(scopeB.customerId).toBe('customer-b');
    expect(jwtFixture.sign(signerInputA).split('.')).toHaveLength(3);
    expect(jwtFixture.sign(signerInputB).split('.')).toHaveLength(3);
    expect(signerInputA).not.toHaveProperty('authorization');
    expect(signerInputA).not.toHaveProperty('token');
  });
});

const describePersistedCustomerSeedContract =
  process.env.RUN_DB_BACKED_CUSTOMER_SEED_TESTS === 'true' ? describe : describe.skip;

describePersistedCustomerSeedContract('Customer persisted-seed contract (T021 expected red until T025–T033)', () => {
  it('requires the generated Customer root model before seeded ownership can be asserted', () => {
    expect(modelFields('Customer')).toEqual(expect.arrayContaining(['id']));
  });

  it('requires Customer-owned KnowledgeDocument policy fields before seed assertions can run', () => {
    expect(modelFields('KnowledgeDocument')).toEqual(
      expect.arrayContaining([
        'customerId',
        'sourceKey',
        'version',
        'visibility',
        'organizationIds',
        'requiredPermissionScopes'
      ])
    );
  });

  it('requires Customer-scoped ToolCall idempotency persistence before seed assertions can run', () => {
    expect(modelFields('ToolCall')).toEqual(expect.arrayContaining(['customerId', 'idempotencyKey']));
  });

  it('requires gated test-database seed rows after the generated persistence contract exists', async () => {
    if (!hasPersistenceContract()) {
      return;
    }

    assertSafeTestDatabaseReset(process.env);
    const prisma = createPrismaClient(process.env.DATABASE_URL!);
    try {
      const customerModel = prisma as unknown as {
        customer: { findMany: (input: unknown) => Promise<unknown[]> };
      };
      const customers = await customerModel.customer.findMany({
        where: { id: { in: ['customer-a', 'customer-b'] } }
      });
      const documents = await (prisma.knowledgeDocument as unknown as {
        findMany: (input: unknown) => Promise<unknown[]>;
      }).findMany({
        where: { sourceKey: CUSTOMER_SCOPE_FIXTURES.shared.sourceKey }
      });

      expect(customers).toHaveLength(2);
      expect(documents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ customerId: 'customer-a', sourceKey: 'shared-source', version: '1' }),
          expect.objectContaining({ customerId: 'customer-b', sourceKey: 'shared-source', version: '1' })
        ])
      );
    } finally {
      await prisma.$disconnect();
    }
  });
});

function modelFields(modelName: string): string[] {
  const namespace = Prisma as unknown as Record<string, unknown>;
  const scalarFieldEnum = namespace[`${modelName}ScalarFieldEnum`];
  return scalarFieldEnum && typeof scalarFieldEnum === 'object'
    ? Object.values(scalarFieldEnum).filter((field): field is string => typeof field === 'string')
    : [];
}

function hasPersistenceContract(): boolean {
  return (
    modelFields('Customer').includes('id') &&
    ['customerId', 'visibility', 'organizationIds', 'requiredPermissionScopes'].every((field) =>
      modelFields('KnowledgeDocument').includes(field)
    ) &&
    modelFields('ToolCall').includes('customerId')
  );
}
