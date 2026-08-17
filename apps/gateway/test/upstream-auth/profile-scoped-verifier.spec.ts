import { createUpstreamJwksFixture, type UpstreamJwksFixture } from './upstream-jwks.fixture';
import type { JSONWebKeySet } from 'jose';
import { JwksTransportError, type JwksTransport } from '../../src/upstream-auth/jwks-transport.adapter';
import { ProfileScopedVerifier, ProfileScopedVerificationError } from '../../src/upstream-auth/profile-scoped-verifier';

describe('Profile-scoped verifier (T019/T020/T025/T026)', () => {
  let fixture: UpstreamJwksFixture;
  beforeAll(async () => { fixture = await createUpstreamJwksFixture(); });
  afterAll(async () => { await fixture.close(); });

  it('verifies exact issuer/audience, policy, times, and canonical claims', async () => {
    const verifier = new ProfileScopedVerifier({ transport: new LocalFixtureJwksTransport() });
    await expect(verifier.verify({ profile: profile(fixture), token: await fixture.issue(), clockToleranceSeconds: 0 })).resolves.toMatchObject({ integrationId: 'integration-a' });
    await expectCredential(verifier.verify({ profile: profile(fixture), token: await fixture.issue({ aud: 'wrong' }), clockToleranceSeconds: 0 }));
    await expectCredential(verifier.verify({ profile: profile(fixture), token: await fixture.issue({ iss: 'wrong' }), clockToleranceSeconds: 0 }));
    await expect(verifier.verify({ profile: profile(fixture), token: await fixture.issue({ roles: [], permission_scopes: [] }), clockToleranceSeconds: 0 })).resolves.toMatchObject({ roles: [], permissionScopes: [] });
    await expectCredential(verifier.verify({ profile: profile(fixture), token: await fixture.issue({ roles: 'planner' }), clockToleranceSeconds: 0 }));
    await expectCredential(verifier.verify({ profile: profile(fixture), token: await fixture.issue({ exp: Math.floor(Date.now() / 1000) - 1 }), clockToleranceSeconds: 0 }));
    await expectCredential(verifier.verify({ profile: { ...profile(fixture), algorithm: 'ES256' }, token: await fixture.issue(), clockToleranceSeconds: 0 }));
    await expectCredential(verifier.verify({ profile: profile(fixture), token: await fixture.issue({}, { kid: '' }), clockToleranceSeconds: 0 }));
  });

  it('rejects a valid-looking token signed by an unpublished key with the published key ID', async () => {
    const transport = new LocalFixtureJwksTransport();
    const verifier = new ProfileScopedVerifier({ transport });
    await expectCredential(verifier.verify({ profile: profile(fixture), token: await fixture.issueWith('new', {}, { kid: fixture.oldKid }), clockToleranceSeconds: 0 }));
    expect(transport.calls).toBe(1);
  });

  it('keeps key-set caches isolated by profile ID', async () => {
    const transport = new LocalFixtureJwksTransport();
    const verifier = new ProfileScopedVerifier({ transport });
    await verifier.verify({ profile: profile(fixture, 'profile-a'), token: await fixture.issue(), clockToleranceSeconds: 0 });
    await verifier.verify({ profile: profile(fixture, 'profile-a'), token: await fixture.issue(), clockToleranceSeconds: 0 });
    await verifier.verify({ profile: profile(fixture, 'profile-b'), token: await fixture.issue(), clockToleranceSeconds: 0 });
    expect(transport.calls).toBe(2);
  });

  it('refreshes once after cooldown and verifies a rotated same-issuer key', async () => {
    const transport = new LocalFixtureJwksTransport();
    let now = 0;
    const verifier = new ProfileScopedVerifier({ transport, now: () => now });
    await verifier.verify({ profile: profile(fixture), token: await fixture.issueWith('old'), clockToleranceSeconds: 0 });
    fixture.publishKeys(['old', 'new']);
    now = 30_001;
    await expect(verifier.verify({ profile: profile(fixture), token: await fixture.issueWith('new'), clockToleranceSeconds: 0 })).resolves.toMatchObject({ integrationId: 'integration-a' });
    expect(transport.calls).toBe(2);
  });

  it('performs at most one refresh for an unknown key and then fails closed', async () => {
    const transport = new LocalFixtureJwksTransport();
    let now = 0;
    const verifier = new ProfileScopedVerifier({ transport, now: () => now });
    await verifier.verify({ profile: profile(fixture), token: await fixture.issueWith('old'), clockToleranceSeconds: 0 });
    now = 30_001;
    await expectCredential(verifier.verify({ profile: profile(fixture), token: await fixture.issueWith('old', {}, { kid: 'unknown' }), clockToleranceSeconds: 0 }));
    expect(transport.calls).toBe(2);
  });

  it('classifies cold-cache and refresh transport failures as infrastructure failures', async () => {
    const cold = new LocalFixtureJwksTransport([1]);
    await expectInfrastructure(new ProfileScopedVerifier({ transport: cold }).verify({ profile: profile(fixture), token: await fixture.issueWith('old'), clockToleranceSeconds: 0 }));
    expect(cold.calls).toBe(1);

    const refresh = new LocalFixtureJwksTransport([2]);
    let now = 0;
    const verifier = new ProfileScopedVerifier({ transport: refresh, now: () => now });
    await verifier.verify({ profile: profile(fixture), token: await fixture.issueWith('old'), clockToleranceSeconds: 0 });
    now = 30_001;
    await expectInfrastructure(verifier.verify({ profile: profile(fixture), token: await fixture.issueWith('old', {}, { kid: 'unknown' }), clockToleranceSeconds: 0 }));
    expect(refresh.calls).toBe(2);
  });
});

function profile(fixture: UpstreamJwksFixture, id = 'profile-a') { return { id, integrationId: 'integration-a', expectedIssuer: fixture.issuer, expectedAudience: fixture.audience, jwksUri: fixture.jwksUri, algorithm: 'RS256' as const, enabled: true, lifecycle: 'active' as const, version: 1, replacesProfileId: null }; }
async function expectCredential(value: Promise<unknown>) { await expect(value).rejects.toMatchObject({ category: 'credential' } satisfies Partial<ProfileScopedVerificationError>); }
async function expectInfrastructure(value: Promise<unknown>) { await expect(value).rejects.toMatchObject({ category: 'infrastructure' } satisfies Partial<ProfileScopedVerificationError>); }

class LocalFixtureJwksTransport implements JwksTransport {
  calls = 0;
  constructor(private readonly failOnCalls: readonly number[] = []) {}
  async fetch(uri: string) {
    this.calls += 1;
    if (this.failOnCalls.includes(this.calls)) throw new JwksTransportError();
    const response = await fetch(uri);
    return await response.json() as JSONWebKeySet;
  }
}
