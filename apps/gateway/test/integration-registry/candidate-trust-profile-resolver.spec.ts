import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const resolverPath = resolve(__dirname, '../../src/integration-registry/candidate-trust-profile.resolver.ts');

describe('Candidate trust-profile resolver boundary (T014/T015/T016)', () => {
  it('requires the resolver production surface', () => expect(existsSync(resolverPath)).toBe(true));

  it('returns zero, one, or multiple registered enabled profiles solely by issuer', async () => {
    const none = createResolver([]);
    await expect(none.resolver.resolve({ issuerHint: 'https://unknown.example.test' })).resolves.toEqual([]);

    const one = createResolver([profile('profile-a', 'integration-a')]);
    await expect(one.resolver.resolve({ issuerHint: 'https://issuer.example.test', kidHint: 'unknown-key' })).resolves.toEqual([profile('profile-a', 'integration-a')]);
    expect(one.repository.findEnabledByIssuer).toHaveBeenCalledWith('https://issuer.example.test');

    const multiple = createResolver([profile('profile-a', 'integration-a'), profile('profile-b', 'integration-b')]);
    await expect(multiple.resolver.resolve({ issuerHint: 'https://issuer.example.test' })).resolves.toHaveLength(2);
  });

  it('keeps shared issuer, audience, and JWKS policy legal and does not use missing or unknown kid as authority', async () => {
    const repository = createResolver([profile('profile-a', 'integration-a'), profile('profile-b', 'integration-b')]);
    await expect(repository.resolver.resolve({ issuerHint: 'https://issuer.example.test' })).resolves.toHaveLength(2);
    await expect(repository.resolver.resolve({ issuerHint: 'https://issuer.example.test', kidHint: 'not-in-profile' })).resolves.toHaveLength(2);
    expect(repository.repository.findEnabledByIssuer).toHaveBeenCalledTimes(2);
  });

  it('has no Customer, binding, identity, request-context, JWKS, or network dependency', () => {
    const source = readFileSync(resolverPath, 'utf8');
    expect(source).not.toMatch(/findBindingByIntegrationId|Customer|customerId|allowedHostApp|CanonicalIdentityResolver|integration_id|org_id|permission_scopes|request\.|headers|query|body|fetch\(|jwk|jwks|dns\.|jwtVerify/);
  });
});

function createResolver(records: readonly ReturnType<typeof profile>[]) {
  if (!existsSync(resolverPath)) throw new Error('Required Batch 2 production surface missing: CandidateTrustProfileResolver.');
  const target = require(resolverPath) as { CandidateTrustProfileResolver?: new (repository: unknown) => { resolve(input: unknown): Promise<unknown> } };
  if (!target.CandidateTrustProfileResolver) throw new Error('Required Batch 2 production surface missing: CandidateTrustProfileResolver.');
  const repository = { findEnabledByIssuer: jest.fn(async (issuer: string) => issuer === 'https://issuer.example.test' ? records : []) };
  return { resolver: new target.CandidateTrustProfileResolver(repository), repository };
}

function profile(id: string, integrationId: string) {
  return { id, integrationId, expectedIssuer: 'https://issuer.example.test', expectedAudience: 'shared-audience', jwksUri: 'https://issuer.example.test/jwks.json', algorithm: 'RS256', enabled: true, lifecycle: 'active', version: 1, replacesProfileId: null };
}
