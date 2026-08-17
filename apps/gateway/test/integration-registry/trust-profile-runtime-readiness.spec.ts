import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const targetPath = resolve(__dirname, '../../src/integration-registry/trust-profile-runtime-readiness.service.ts');
const runtimePaths = [
  '../../src/upstream-auth/multi-profile-upstream-token-verifier.ts',
  '../../src/upstream-auth/profile-scoped-verifier.ts',
  '../../src/integration-registry/candidate-trust-profile.resolver.ts',
  '../../src/backend-client/gateway-trust-chain.handler.ts'
];

describe('Profile-only runtime readiness (T039)', () => {
  it.each([
    ['no profiles', []],
    ['disabled/draft profiles', [profile({ enabled: false, lifecycle: 'disabled' }), profile({ id: 'draft', lifecycle: 'draft', enabled: false })]],
    ['invalid algorithm', [profile({ algorithm: 'ES256' })]],
    ['unsafe source', [profile({ jwksUri: 'https://localhost/jwks' })]]
  ])('fails closed for %s even when legacy settings may exist', async (_label, profiles) => {
    const readiness = createReadiness(profiles);
    await expect(readiness.assertReady()).rejects.toThrow('Profile runtime readiness cannot be completed.');
  });

  it('accepts an active valid profile without legacy configuration', async () => {
    const readiness = createReadiness([profile()]);
    await expect(readiness.assertReady()).resolves.toBeUndefined();
  });

  it('has no binding, Customer, or HostApp authority dependency', () => {
    expect(existsSync(targetPath)).toBe(true);
    const source = existsSync(targetPath) ? require('node:fs').readFileSync(targetPath, 'utf8') : '';
    expect(source).not.toMatch(/IntegrationBinding|Customer|allowedHostApp|CanonicalIdentityResolver/);
  });

  it('keeps legacy upstream environment settings out of runtime verification surfaces', () => {
    for (const relativePath of runtimePaths) {
      const runtimePath = resolve(__dirname, relativePath);
      expect(existsSync(runtimePath)).toBe(true);
      const source = existsSync(runtimePath) ? require('node:fs').readFileSync(runtimePath, 'utf8') : '';
      expect(source).not.toMatch(/GATEWAY_UPSTREAM_(?:JWT_ISSUER|JWT_AUDIENCE|JWKS_URI)/);
    }
  });
});

function createReadiness(profiles: ReturnType<typeof profile>[]) {
  if (!existsSync(targetPath)) throw new Error('Required profile runtime readiness surface is missing.');
  const target = require(targetPath) as { TrustProfileRuntimeReadiness?: new (repository: unknown) => { assertReady(): Promise<void> } };
  if (!target.TrustProfileRuntimeReadiness) throw new Error('Required profile runtime readiness surface is missing.');
  return new target.TrustProfileRuntimeReadiness({ findEnabledActiveProfiles: jest.fn(async () => profiles) });
}

function profile(overrides: Record<string, unknown> = {}) {
  return { id: 'profile-a', integrationId: 'integration-a', expectedIssuer: 'https://issuer.example.test', expectedAudience: 'gateway', jwksUri: 'https://issuer.example.test/jwks', algorithm: 'RS256', enabled: true, lifecycle: 'active', version: 1, replacesProfileId: null, ...overrides };
}
