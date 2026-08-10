import { createUpstreamJwksFixture, type UpstreamJwksFixture } from './upstream-jwks.fixture';

describe('VerifiedUpstreamIdentity claim contract (T029)', () => {
  let fixture: UpstreamJwksFixture;
  beforeAll(async () => { fixture = await createUpstreamJwksFixture(); });
  afterAll(async () => { await fixture.close(); });

  it('uses only cryptographically verified upstream claims and ignores customer/public-input authority', async () => {
    const verifier = await verifierFor(fixture);
    const identity = await verifier.verify({ authorization: `Bearer ${await fixture.issue({ customer_id: 'customer-attacker', pageContext: { customer_id: 'customer-other' } })}` });
    expect(identity).toMatchObject({ integrationId: 'integration-a', subject: 'actor-a', organizationId: 'org-shared', hostApp: 'admin', roles: ['planner'], permissionScopes: ['orders:read'] });
    expect(identity).not.toHaveProperty('customerId');
    expect(identity).not.toHaveProperty('customer_id');
    expect(JSON.stringify(identity)).not.toContain('customer-attacker');
  });

  it('ignores conflicting public headers, body, query, PageContext, and metadata', async () => {
    const verifier = await verifierFor(fixture);
    const identity = await verifier.verify({
      authorization: `Bearer ${await fixture.issue()}`,
      headers: {
        'x-integration-id': 'integration-attacker',
        'x-customer-id': 'customer-attacker',
        'x-organization-id': 'org-attacker',
        'x-host-app': 'other'
      },
      body: { integration_id: 'integration-attacker', customer_id: 'customer-attacker' },
      query: { integration_id: 'integration-attacker' },
      pageContext: { customer_id: 'customer-attacker' },
      metadata: { customer_id: 'customer-attacker' }
    } as never);

    expect(identity).toEqual({
      integrationId: 'integration-a',
      subject: 'actor-a',
      organizationId: 'org-shared',
      hostApp: 'admin',
      roles: ['planner'],
      permissionScopes: ['orders:read']
    });
    expect(identity).not.toHaveProperty('customerId');
    expect(identity).not.toHaveProperty('customer_id');
  });

  it.each([
    ['missing integration_id', { integration_id: '' }], ['blank sub', { sub: '   ' }], ['missing org_id', { org_id: null }], ['blank host_app', { host_app: '' }],
    ['roles scalar', { roles: 'admin' }], ['roles blank member', { roles: ['admin', ''] }], ['scopes number member', { permission_scopes: [123] }], ['scopes object', { permission_scopes: {} }]
  ])('rejects %s after verification', async (_label, claims) => {
    const verifier = await verifierFor(fixture);
    await expect(verifier.verify({ authorization: `Bearer ${await fixture.issue(claims)}` })).rejects.toMatchObject({ status: 401, code: 'UPSTREAM_IDENTITY_INVALID' });
  });

  it('keeps valid empty roles and scopes immutable', async () => {
    const verifier = await verifierFor(fixture);
    const identity = await verifier.verify({ authorization: `Bearer ${await fixture.issue({ roles: [], permission_scopes: [] })}` });
    expect(identity.roles).toEqual([]);
    expect(identity.permissionScopes).toEqual([]);
    expect(Object.isFrozen(identity)).toBe(true);
    expect(Object.isFrozen(identity.roles)).toBe(true);
  });
});

async function verifierFor(fixture: UpstreamJwksFixture) {
  const target = require('../../src/upstream-auth/upstream-token-verifier.service') as { RemoteJwksUpstreamTokenVerifier?: new (config: unknown) => { verify(input: { authorization: string }): Promise<any> } };
  if (!target.RemoteJwksUpstreamTokenVerifier) throw new Error('Expected Phase 3 upstream verifier implementation.');
  return new target.RemoteJwksUpstreamTokenVerifier({ issuer: fixture.issuer, audience: fixture.audience, jwksUri: fixture.jwksUri, clockToleranceSeconds: 0 });
}
