import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const validatorPath = resolve(__dirname, '../../src/integration-registry/trust-profile-activation.validator.ts');

describe('Trust-profile activation validation contract (T002/T006)', () => {
  it('requires the activation validator production surface', () => {
    expect(existsSync(validatorPath)).toBe(true);
  });

  it.each([
    ['missing IntegrationBinding', {}, { binding: null }],
    ['blank issuer', { expectedIssuer: '  ' }, {}],
    ['blank audience', { expectedAudience: '  ' }, {}],
    ['invalid JWKS URI', { jwksUri: 'not a url' }, {}],
    ['unsafe JWKS URI', { jwksUri: 'https://127.0.0.1/keys' }, {}],
    ['IPv6 loopback JWKS URI', { jwksUri: 'https://[::1]/keys' }, {}],
    ['IPv6 private JWKS URI', { jwksUri: 'https://[fc00::1]/keys' }, {}],
    ['normalized localhost JWKS URI', { jwksUri: 'https://LOCALHOST./keys' }, {}],
    ['normalized localhost subdomain JWKS URI', { jwksUri: 'https://foo.localhost./keys' }, {}],
    ['unsupported algorithm', { algorithm: 'ES256' }, {}],
    ['invalid active lifecycle', { lifecycle: 'draft', enabled: true }, {}],
    ['invalid replacement relation', { replacesProfileId: 'profile-a', version: 1 }, {}],
    ['self replacement relation', { replacesProfileId: 'profile-a', version: 2 }, {}],
    ['potential duplicate decision', {}, { duplicates: [profile({ id: 'profile-duplicate' })] }]
  ])('rejects %s before activation', async (_label, changes, repositoryChanges) => {
    const validator = createValidator(repositoryChanges as never);
    await expect(validator.validate({ ...profile(), ...changes } as never)).rejects.toThrow('Trust profile activation cannot be completed.');
  });

  it.each(['customerId', 'allowedHostApp'])('rejects %s as a profile authority input', async (forbiddenField) => {
    const validator = createValidator();
    await expect(validator.validate({ ...profile(), [forbiddenField]: 'authority-injection' } as never)).rejects.toThrow();
  });

  it('does not make binding enabled state or HostApp matching an activation concern', async () => {
    const validator = createValidator({ binding: { integrationId: 'integration-a', enabled: false, allowedHostApp: 'admin' } });
    await expect(validator.validate(profile())).resolves.toEqual(expect.objectContaining({ integrationId: 'integration-a' }));
  });

  it('permits a normal HTTPS DNS hostname', async () => {
    const validator = createValidator();
    await expect(validator.validate(profile({ jwksUri: 'https://Issuer.Example.Test/keys' }))).resolves.toEqual(expect.objectContaining({ jwksUri: 'https://Issuer.Example.Test/keys' }));
  });
});

function createValidator(overrides: Partial<{ binding: unknown; duplicates: unknown[] }> = {}) {
  if (!existsSync(validatorPath)) throw new Error('Required Batch 1 production surface missing: TrustProfileActivationValidator.');
  const target = require(validatorPath) as {
    TrustProfileActivationValidator?: new (dependencies: unknown) => { validate(input: unknown): Promise<unknown> };
    ProductionJwksSourceRegistrationPolicy?: new () => { validate(value: string): void };
  };
  if (!target.TrustProfileActivationValidator) throw new Error('Required Batch 1 production surface missing: TrustProfileActivationValidator.');
  return new target.TrustProfileActivationValidator({
    repository: {
      findBindingByIntegrationId: jest.fn(async () => overrides.binding === undefined ? { integrationId: 'integration-a', enabled: true, allowedHostApp: 'admin' } : overrides.binding),
      findEnabledExactPolicy: jest.fn(async () => overrides.duplicates ?? [])
    },
    jwksSourcePolicy: new (target.ProductionJwksSourceRegistrationPolicy as new () => { validate(value: string): void })()
  });
}

function profile(overrides: Record<string, unknown> = {}) {
  return {
    id: 'profile-a', integrationId: 'integration-a', expectedIssuer: 'https://issuer.example.test', expectedAudience: 'gateway-audience',
    jwksUri: 'https://issuer.example.test/.well-known/jwks.json', algorithm: 'RS256', enabled: true,
    lifecycle: 'active', version: 1, replacesProfileId: undefined, ...overrides
  };
}
