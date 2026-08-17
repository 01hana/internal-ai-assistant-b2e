import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ProfileScopedVerificationError } from '../../src/upstream-auth/profile-scoped-verifier';
import { MalformedRoutingMetadataError } from '../../src/upstream-auth/routing-metadata.parser';
import { UpstreamIdentityServiceUnavailableError } from '../../src/upstream-auth/upstream-auth.error';
import type { VerifiedUpstreamIdentity } from '../../src/upstream-auth/verified-upstream-identity';

const modulePath = '../../src/upstream-auth/multi-profile-upstream-token-verifier';
const compactToken = 'eyJhbGciOiJSUzI1NiIsImtpZCI6ImtpZCJ9.eyJpc3MiOiJodHRwczovL2lzc3Vlci50ZXN0In0.signature';

describe('Multi-profile upstream token verifier (T030/T031)', () => {
  it('fails closed when routing has zero candidates', async () => {
    const verifier = createVerifier([]);
    await expect(verifier.verify({ authorization: `Bearer ${compactToken}` })).rejects.toMatchObject({ reasonCode: 'invalid_signature' });
    expect(verifier.profileVerifier.verify).not.toHaveBeenCalled();
  });

  it('returns the existing identity object for exactly one verified profile decision', async () => {
    const identity = verified('integration-a');
    const candidate = profile('profile-a', 'integration-a');
    const verifier = createVerifier([candidate], { 'profile-a': identity });
    await expect(verifier.verify({ authorization: `Bearer ${compactToken}` })).resolves.toBe(identity);
  });

  it('does not form a decision when a cryptographically verified identity anchors another integration', async () => {
    const verifier = createVerifier([profile('profile-a', 'integration-a')], { 'profile-a': verified('integration-b') });
    await expect(verifier.verify({ authorization: `Bearer ${compactToken}` })).rejects.toMatchObject({ reasonCode: 'invalid_signature' });
  });

  it('accepts exactly one matching decision for shared IdP policy candidates', async () => {
    const identity = verified('integration-a');
    const verifier = createVerifier([profile('profile-a', 'integration-a'), profile('profile-b', 'integration-b')], { 'profile-a': identity, 'profile-b': identity });
    await expect(verifier.verify({ authorization: `Bearer ${compactToken}` })).resolves.toBe(identity);
    expect(verifier.profileVerifier.verify).toHaveBeenCalledTimes(2);
  });

  it('fails closed for multiple verified decisions rather than selecting a profile', async () => {
    const identity = verified('integration-a');
    const verifier = createVerifier([profile('profile-a1', 'integration-a'), profile('profile-a2', 'integration-a')], { 'profile-a1': identity, 'profile-a2': identity });
    await expect(verifier.verify({ authorization: `Bearer ${compactToken}` })).rejects.toMatchObject({ reasonCode: 'invalid_signature' });
  });

  it('does not verify disabled or non-active injected candidates', async () => {
    const verifier = createVerifier([profile('disabled', 'integration-a', false, 'disabled'), profile('draft', 'integration-a', true, 'draft')]);
    await expect(verifier.verify({ authorization: `Bearer ${compactToken}` })).rejects.toMatchObject({ reasonCode: 'invalid_signature' });
    expect(verifier.profileVerifier.verify).not.toHaveBeenCalled();
  });

  it('fails closed as infrastructure when any candidate cannot be safely evaluated', async () => {
    const identity = verified('integration-a');
    const verifier = createVerifier([profile('profile-a', 'integration-a'), profile('profile-b', 'integration-b')], {
      'profile-a': identity,
      'profile-b': new ProfileScopedVerificationError('infrastructure')
    });
    await expect(verifier.verify({ authorization: `Bearer ${compactToken}` })).rejects.toBeInstanceOf(UpstreamIdentityServiceUnavailableError);
  });

  it('classifies malformed routing metadata as generic authentication failure', async () => {
    const verifier = createVerifier([], {}, { parserError: new MalformedRoutingMetadataError() });
    await expect(verifier.verify({ authorization: `Bearer ${compactToken}` })).rejects.toMatchObject({ reasonCode: 'invalid_signature' });
    expect(verifier.profileVerifier.verify).not.toHaveBeenCalled();
  });

  it('classifies a candidate registry failure as generic infrastructure without verification', async () => {
    const verifier = createVerifier([], {}, { resolverError: new Error('database unavailable') });
    await expect(verifier.verify({ authorization: `Bearer ${compactToken}` })).rejects.toMatchObject({ name: 'MultiProfileInfrastructureError', category: 'infrastructure', message: 'Multi-profile verification cannot be completed.' });
    await expect(verifier.verify({ authorization: `Bearer ${compactToken}` })).rejects.not.toThrow('database unavailable');
    expect(verifier.profileVerifier.verify).not.toHaveBeenCalled();
  });

  it('continues after one candidate credential failure when another candidate forms the only decision', async () => {
    const identity = verified('integration-b');
    const verifier = createVerifier([profile('profile-a', 'integration-a'), profile('profile-b', 'integration-b')], {
      'profile-a': new ProfileScopedVerificationError('credential'),
      'profile-b': identity
    });
    await expect(verifier.verify({ authorization: `Bearer ${compactToken}` })).resolves.toBe(identity);
  });

  it('contains no resolver or canonical authority dependency', async () => {
    const sourcePath = resolve(process.cwd(), 'src/upstream-auth/multi-profile-upstream-token-verifier.ts');
    expect(existsSync(sourcePath)).toBe(true);
    const source = await readFile(sourcePath, 'utf8');
    expect(source).not.toMatch(/IntegrationBinding|CanonicalIdentityResolver|CanonicalGatewayIdentity|allowedHostApp|customerId|Customer/);
  });

  it('contains no legacy verifier or legacy upstream configuration fallback', async () => {
    const source = await readFile(resolve(process.cwd(), 'src/upstream-auth/multi-profile-upstream-token-verifier.ts'), 'utf8');
    expect(source).not.toMatch(/RemoteJwksUpstreamTokenVerifier|GATEWAY_UPSTREAM_JWT_(?:ISSUER|AUDIENCE|JWKS_URI)/);
  });
});

function createVerifier(candidates: readonly ReturnType<typeof profile>[], outcomes: Record<string, VerifiedUpstreamIdentity | Error> = {}, options: Readonly<{ parserError?: Error; resolverError?: Error }> = {}) {
  const target = require(modulePath) as { MultiProfileUpstreamTokenVerifier: new (input: unknown) => { verify(input: unknown): Promise<VerifiedUpstreamIdentity> } };
  const parser = { parse: jest.fn(() => { if (options.parserError) throw options.parserError; return { issuerHint: 'https://issuer.test', kidHint: 'kid' }; }) };
  const candidateResolver = { resolve: jest.fn(async () => { if (options.resolverError) throw options.resolverError; return candidates; }) };
  const profileVerifier = { verify: jest.fn(async ({ profile: candidate }: { profile: ReturnType<typeof profile> }) => {
    const outcome = outcomes[candidate.id];
    if (outcome instanceof Error) throw outcome;
    if (!outcome) throw new ProfileScopedVerificationError('credential');
    return outcome;
  }) };
  const verifier = new target.MultiProfileUpstreamTokenVerifier({ parser, candidateResolver, profileVerifier, clockToleranceSeconds: 0 });
  return Object.assign(verifier, { parser, candidateResolver, profileVerifier });
}

function profile(id: string, integrationId: string, enabled = true, lifecycle: 'active' | 'disabled' | 'draft' = 'active') {
  return { id, integrationId, expectedIssuer: 'https://issuer.test', expectedAudience: 'gateway', jwksUri: 'https://issuer.test/jwks', algorithm: 'RS256', enabled, lifecycle, version: 1, replacesProfileId: null } as const;
}
function verified(integrationId: string): VerifiedUpstreamIdentity { return Object.freeze({ integrationId, subject: 'actor', organizationId: 'org', hostApp: 'admin', roles: Object.freeze([]), permissionScopes: Object.freeze([]) }); }
