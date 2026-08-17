import type { VerifiedUpstreamIdentity } from '../../src/upstream-auth/verified-upstream-identity';
import { ProfileScopedVerificationError } from '../../src/upstream-auth/profile-scoped-verifier';
import { ProfileScopedVerifier } from '../../src/upstream-auth/profile-scoped-verifier';
import { createUpstreamJwksFixture, type UpstreamJwksFixture } from './upstream-jwks.fixture';
import type { JwksTransport } from '../../src/upstream-auth/jwks-transport.adapter';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const modulePath = '../../src/upstream-auth/multi-profile-upstream-token-verifier';
const compactToken = 'eyJhbGciOiJSUzI1NiIsImtpZCI6ImtpZCJ9.eyJpc3MiOiJodHRwczovL2lzc3Vlci50ZXN0In0.signature';

describe('Upstream profile-verification telemetry (T047/T048)', () => {
  it('contains no identity authority, JWT, or transport dependency', () => {
    const source = readFileSync(resolve(__dirname, '../../src/upstream-auth/upstream-auth-telemetry.ts'), 'utf8');
    expect(source).not.toMatch(/IntegrationBindingRepository|CanonicalIdentityResolver|Customer|GatewayBackendClient|InternalIdentityTokenIssuer|decode[A-Z]|jwtVerify|fetch\s*\(/);
  });

  it('records a safe no-candidate denial without unverified routing values', async () => {
    const verifier = createVerifier([]);
    await expect(verifier.verify(input())).rejects.toMatchObject({ reasonCode: 'invalid_signature' });
    expect(verifier.telemetry.record).toHaveBeenCalledWith(expect.objectContaining({
      requestId: 'request-telemetry', outcome: 'denied', reasonCode: 'no_candidate'
    }));
    expect(verifier.telemetry.record.mock.calls[0]?.[0]).not.toHaveProperty('profileId');
    expect(JSON.stringify(verifier.telemetry.record.mock.calls)).not.toMatch(/issuer\.test|kid|Bearer|signature/i);
  });

  it('records disabled candidates without invoking profile verification', async () => {
    const verifier = createVerifier([profile('profile-a', 'integration-a', false, 'disabled')]);
    await expect(verifier.verify(input())).rejects.toMatchObject({ reasonCode: 'invalid_signature' });
    expect(verifier.profileVerifier.verify).not.toHaveBeenCalled();
    expect(verifier.telemetry.record).toHaveBeenCalledWith(expect.objectContaining({
      outcome: 'denied', reasonCode: 'profile_disabled', profileId: 'profile-a', integrationId: 'integration-a'
    }));
  });

  it.each([
    ['signature', 'signature_invalid'],
    ['unknown key', 'unknown_kid'],
    ['issuer', 'issuer_mismatch'],
    ['audience', 'audience_mismatch'],
    ['claim shape', 'claim_invalid']
  ])('records a structured %s credential reason without sensitive values', async (_label, reason) => {
    const verifier = createVerifier([profile('profile-a', 'integration-a')], {
      'profile-a': new ProfileScopedVerificationError('credential', reason as never)
    });
    await expect(verifier.verify(input())).rejects.toMatchObject({ reasonCode: 'invalid_signature' });
    expect(verifier.telemetry.record).toHaveBeenCalledWith(expect.objectContaining({
      outcome: 'denied', reasonCode: reason, profileId: 'profile-a', integrationId: 'integration-a'
    }));
    expect(JSON.stringify(verifier.telemetry.record.mock.calls)).not.toMatch(/Bearer|issuer\.test|jwks|customer/i);
  });

  it('records profile/integration mismatch and ambiguity at the verifier boundary', async () => {
    const mismatch = createVerifier([profile('profile-a', 'integration-a')], { 'profile-a': identity('integration-b') });
    await expect(mismatch.verify(input())).rejects.toMatchObject({ reasonCode: 'invalid_signature' });
    expect(mismatch.telemetry.record).toHaveBeenCalledWith(expect.objectContaining({ reasonCode: 'profile_integration_mismatch', profileId: 'profile-a', integrationId: 'integration-a' }));

    const ambiguous = createVerifier([profile('profile-a', 'integration-a'), profile('profile-b', 'integration-a')], {
      'profile-a': identity('integration-a'), 'profile-b': identity('integration-a')
    });
    await expect(ambiguous.verify(input())).rejects.toMatchObject({ reasonCode: 'invalid_signature' });
    const events = (ambiguous.telemetry.record.mock.calls as unknown as Array<[unknown]>).map(([event]) => event);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ reasonCode: 'ambiguous_profile_decision', profileId: 'profile-a', integrationId: 'integration-a' }),
      expect.objectContaining({ reasonCode: 'ambiguous_profile_decision', profileId: 'profile-b', integrationId: 'integration-a' })
    ]));
  });

  it('records verified identity fields only after exactly one decision and never a Customer', async () => {
    const verified = identity('integration-a');
    const verifier = createVerifier([profile('profile-a', 'integration-a')], { 'profile-a': verified });
    await expect(verifier.verify(input())).resolves.toBe(verified);
    expect(verifier.telemetry.record).toHaveBeenCalledWith({
      requestId: 'request-telemetry', outcome: 'success', reasonCode: 'verified',
      profileId: 'profile-a', integrationId: 'integration-a', actorId: 'actor-a', hostApp: 'admin'
    });
    expect(JSON.stringify(verifier.telemetry.record.mock.calls)).not.toMatch(/customerId|customer-a|roles|permission/i);
  });

  it('records generic infrastructure without changing its infrastructure failure', async () => {
    const verifier = createVerifier([profile('profile-a', 'integration-a')], {
      'profile-a': new ProfileScopedVerificationError('infrastructure')
    });
    await expect(verifier.verify(input())).rejects.toMatchObject({ category: 'infrastructure' });
    expect(verifier.telemetry.record).toHaveBeenCalledWith(expect.objectContaining({
      reasonCode: 'verification_infrastructure_unavailable', profileId: 'profile-a', integrationId: 'integration-a'
    }));
  });

  it('does not invent a profile ID when registered-profile resolution is unavailable', async () => {
    const verifier = createVerifier([], {}, { resolverError: new Error('database unavailable') });
    await expect(verifier.verify(input())).rejects.toMatchObject({ category: 'infrastructure' });
    expect(verifier.profileVerifier.verify).not.toHaveBeenCalled();
    expect(verifier.telemetry.record).toHaveBeenCalledWith(expect.objectContaining({ reasonCode: 'verification_infrastructure_unavailable' }));
    expect(verifier.telemetry.record.mock.calls[0]?.[0]).not.toHaveProperty('profileId');
  });

  it('suppresses telemetry persistence failures without changing verification outcome', async () => {
    const verified = identity('integration-a');
    const verifier = createVerifier([profile('profile-a', 'integration-a')], { 'profile-a': verified }, { telemetryError: new Error('audit backend unavailable') });
    await expect(verifier.verify(input())).resolves.toBe(verified);
  });

  it('does not take a token-supplied profile_id as audit identity', async () => {
    const verified = identity('integration-a');
    const verifier = createVerifier([profile('profile-a', 'integration-a')], { 'profile-a': verified });
    await expect(verifier.verify({ ...input(), profile_id: 'attacker-profile' } as never)).resolves.toBe(verified);
    expect(verifier.telemetry.record).toHaveBeenCalledWith(expect.objectContaining({ profileId: 'profile-a' }));
    expect(JSON.stringify(verifier.telemetry.record.mock.calls)).not.toContain('attacker-profile');
  });

  it('forwards a real profile-verifier structured reason to telemetry', async () => {
    const fixture = await createUpstreamJwksFixture();
    try {
      const telemetry = { record: jest.fn(async () => undefined) };
      const parser = { parse: jest.fn(() => ({ issuerHint: fixture.issuer, kidHint: fixture.oldKid })) };
      const candidate = profile('profile-real', 'integration-a', true, 'active', fixture.issuer, fixture.audience, fixture.jwksUri);
      const target = require(modulePath) as { MultiProfileUpstreamTokenVerifier: new (input: unknown) => { verify(input: unknown): Promise<VerifiedUpstreamIdentity> } };
      const verifier = new target.MultiProfileUpstreamTokenVerifier({
        parser,
        candidateResolver: { resolve: jest.fn(async () => [candidate]) },
        profileVerifier: new ProfileScopedVerifier({ transport: new FixtureTransport() }),
        telemetry,
        clockToleranceSeconds: 0
      });
      await expect(verifier.verify({ authorization: `Bearer ${await fixture.issueWith('new', {}, { kid: fixture.oldKid })}`, requestId: 'request-real' })).rejects.toMatchObject({ reasonCode: 'invalid_signature' });
      expect(telemetry.record).toHaveBeenCalledWith(expect.objectContaining({ reasonCode: 'signature_invalid', profileId: 'profile-real', integrationId: 'integration-a' }));
    } finally {
      await fixture.close();
    }
  });
});

function createVerifier(candidates: readonly ReturnType<typeof profile>[], outcomes: Record<string, VerifiedUpstreamIdentity | Error> = {}, options: Readonly<{ telemetryError?: Error; resolverError?: Error }> = {}) {
  const target = require(modulePath) as { MultiProfileUpstreamTokenVerifier: new (input: unknown) => { verify(input: unknown): Promise<VerifiedUpstreamIdentity> } };
  const parser = { parse: jest.fn(() => ({ issuerHint: 'https://issuer.test', kidHint: 'kid' })) };
  const candidateResolver = { resolve: jest.fn(async () => { if (options.resolverError) throw options.resolverError; return candidates; }) };
  const profileVerifier = { verify: jest.fn(async ({ profile: candidate }: { profile: ReturnType<typeof profile> }) => {
    const outcome = outcomes[candidate.id];
    if (outcome instanceof Error) throw outcome;
    if (!outcome) throw new ProfileScopedVerificationError('credential', 'credential_invalid');
    return outcome;
  }) };
  const telemetry = { record: jest.fn(async (_event: unknown) => { if (options.telemetryError) throw options.telemetryError; }) };
  const verifier = new target.MultiProfileUpstreamTokenVerifier({ parser, candidateResolver, profileVerifier, telemetry, clockToleranceSeconds: 0 });
  return Object.assign(verifier, { profileVerifier, telemetry });
}

function input() { return { authorization: `Bearer ${compactToken}`, requestId: 'request-telemetry' }; }
function profile(id: string, integrationId: string, enabled = true, lifecycle: 'active' | 'disabled' | 'draft' = 'active', expectedIssuer = 'https://issuer.test', expectedAudience = 'gateway', jwksUri = 'https://issuer.test/jwks') {
  return { id, integrationId, expectedIssuer, expectedAudience, jwksUri, algorithm: 'RS256' as const, enabled, lifecycle, version: 1, replacesProfileId: null };
}
function identity(integrationId: string): VerifiedUpstreamIdentity { return Object.freeze({ integrationId, subject: 'actor-a', organizationId: 'org-a', hostApp: 'admin', roles: Object.freeze([]), permissionScopes: Object.freeze([]) }); }

class FixtureTransport implements JwksTransport {
  async fetch(uri: string) { return await (await fetch(uri)).json(); }
}
