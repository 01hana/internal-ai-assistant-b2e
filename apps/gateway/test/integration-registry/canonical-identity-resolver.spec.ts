import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createVerifiedUpstreamIdentity } from '../../src/upstream-auth/verified-upstream-identity';

const resolverPath = resolve(__dirname, '../../src/integration-registry/canonical-identity-resolver.service');
const identityPath = resolve(__dirname, '../../src/identity/canonical-gateway-identity');

describe('Canonical identity resolver contract (T036/T038/T039/T040)', () => {
  it('starts RED only because the Phase 4 resolver and composer production surfaces are absent', () => {
    expect(existsSync(`${resolverPath}.ts`)).toBe(true);
    expect(existsSync(`${identityPath}.ts`)).toBe(true);
  });

  it('resolves Customer authority solely from the exact IntegrationBinding lookup', async () => {
    const { CanonicalIdentityResolver } = loadResolver();
    const findByIntegrationId = jest.fn().mockResolvedValue(binding());
    const append = jest.fn();
    const identity = verifiedIdentity();
    const resolver = new CanonicalIdentityResolver({ findByIntegrationId }, { append });

    const result = await resolver.resolve({
      identity,
      requestId: 'request-resolution-a',
      customerId: 'customer-b',
      requestedCustomerId: 'customer-b',
      headers: { 'x-customer-id': 'customer-b' },
      body: { customer_id: 'customer-b' },
      query: { customer_id: 'customer-b' },
      metadata: { customer_id: 'customer-b' }
    } as never);

    expect(result).toEqual({
      customerId: 'customer-a',
      integrationId: 'integration-a',
      subject: 'actor-shared',
      organizationId: 'org-shared',
      hostApp: 'admin',
      roles: ['planner'],
      permissionScopes: ['orders:read']
    });
    expect(findByIntegrationId).toHaveBeenCalledTimes(1);
    expect(findByIntegrationId).toHaveBeenCalledWith('integration-a');
    expect(append).not.toHaveBeenCalled();
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.roles)).toBe(true);
    expect(Object.isFrozen(result.permissionScopes)).toBe(true);
  });

  it('clones verified roles and scopes before freezing the canonical identity', async () => {
    const { CanonicalIdentityResolver } = loadResolver();
    const identity = verifiedIdentity();
    const resolver = new CanonicalIdentityResolver({ findByIntegrationId: jest.fn().mockResolvedValue(binding()) }, { append: jest.fn() });
    const result = await resolver.resolve({ identity, requestId: 'request-immutable' });

    expect(result.roles).not.toBe(identity.roles);
    expect(result.permissionScopes).not.toBe(identity.permissionScopes);
    expect(() => (result.roles as string[]).push('attacker')).toThrow();
    expect(() => (result.permissionScopes as string[]).push('attacker')).toThrow();
  });

  it.each([
    ['unknown binding', null],
    ['disabled binding', binding({ enabled: false })],
    ['HostApp mismatch', binding({ allowedHostApp: 'other' })],
    ['binding integration mismatch', binding({ integrationId: 'integration-b' })],
    ['blank Customer ID', binding({ customerId: '   ' })]
  ])('fails closed for %s with one lookup and generic denial audit', async (_label, repositoryResult) => {
    const { CanonicalIdentityResolver } = loadResolver();
    const findByIntegrationId = jest.fn().mockResolvedValue(repositoryResult);
    const append = jest.fn().mockResolvedValue(undefined);
    const resolver = new CanonicalIdentityResolver({ findByIntegrationId }, { append });

    await expect(resolver.resolve({ identity: verifiedIdentity(), requestId: 'request-denied' })).rejects.toMatchObject({
      status: 403,
      code: 'IDENTITY_ISSUANCE_DENIED',
      message: 'Identity issuance cannot be completed.'
    });
    await expectSerializedGenericDenial(resolver);

    expect(findByIntegrationId).toHaveBeenCalledWith('integration-a');
    expect(append).toHaveBeenCalledWith({
      requestId: expect.any(String),
      eventType: 'identity_resolution_denied',
      outcome: 'denied',
      reasonCode: 'identity_issuance_denied',
      integrationId: 'integration-a',
      actorId: 'actor-shared',
      hostApp: 'admin'
    });
    expect(JSON.stringify(append.mock.calls)).not.toMatch(/customer-a|customer-b|unknown_binding|disabled_binding|host_app_mismatch|binding_mismatch|invalid_binding/i);
  });

  it('keeps the same generic denial when denial audit persistence fails', async () => {
    const { CanonicalIdentityResolver } = loadResolver();
    const resolver = new CanonicalIdentityResolver({ findByIntegrationId: jest.fn().mockResolvedValue(null) }, { append: jest.fn().mockRejectedValue(new Error('database detail')) });

    await expect(resolver.resolve({ identity: verifiedIdentity(), requestId: 'request-audit-failure' })).rejects.toMatchObject({
      status: 403,
      code: 'IDENTITY_ISSUANCE_DENIED',
      message: 'Identity issuance cannot be completed.'
    });
  });
});

async function expectSerializedGenericDenial(resolver: { resolve(input: unknown): Promise<unknown> }) {
  try {
    await resolver.resolve({ identity: verifiedIdentity(), requestId: 'request-denied-json' });
    throw new Error('Expected canonical resolution denial.');
  } catch (error) {
    expect(JSON.stringify(error)).not.toMatch(/unknown_binding|disabled_binding|host_app_mismatch|binding_mismatch|invalid_binding|customer-a|integration-b/i);
  }
}

function loadResolver(): { CanonicalIdentityResolver: new (repository: unknown, telemetry: unknown) => { resolve(input: unknown): Promise<any> } } {
  if (!existsSync(`${resolverPath}.ts`)) {
    throw new Error('Expected Phase 4 CanonicalIdentityResolver production surface.');
  }
  const target = require(resolverPath) as { CanonicalIdentityResolver?: new (repository: unknown, telemetry: unknown) => { resolve(input: unknown): Promise<any> } };
  if (!target.CanonicalIdentityResolver) throw new Error('Expected Phase 4 CanonicalIdentityResolver production surface.');
  return { CanonicalIdentityResolver: target.CanonicalIdentityResolver };
}

function verifiedIdentity() {
  return createVerifiedUpstreamIdentity({
    integration_id: 'integration-a',
    sub: 'actor-shared',
    org_id: 'org-shared',
    host_app: 'admin',
    roles: ['planner'],
    permission_scopes: ['orders:read']
  });
}

function binding(overrides: Partial<{ integrationId: string; customerId: string; allowedHostApp: string; enabled: boolean }> = {}) {
  return { integrationId: 'integration-a', customerId: 'customer-a', allowedHostApp: 'admin', enabled: true, ...overrides };
}
