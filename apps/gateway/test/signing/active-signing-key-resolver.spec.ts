import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createEphemeralRsaFixture } from './ephemeral-rsa.fixture';

const resolverPath = resolve(__dirname, '../../src/signing/active-signing-key-resolver.ts');

describe('ActiveSigningKeyResolver contract (T047 micro-RED)', () => {
  it('requires the Phase 5 active signing-key resolver production surface', () => {
    expect(existsSync(resolverPath)).toBe(true);
  });

  it('selects only a valid active row and returns only its kid and signing handle', async () => {
    const fixture = await createEphemeralRsaFixture();
    const provider = { load: jest.fn(async () => fixture.privateKey) };
    const repository = { findActive: jest.fn(async () => keyRow('active', fixture)) };
    const resolver = createResolver(repository, provider);

    await expect(resolver.resolveActiveSigningKey()).resolves.toEqual({ kid: fixture.kid, privateKey: fixture.privateKey });
    expect(repository.findActive).toHaveBeenCalledTimes(1);
    expect(provider.load).toHaveBeenCalledWith('file:/test/gateway-private.pem');
  });

  it.each(['no active row', 'published', 'retiring', 'new', 'retired'])(
    'fails closed for %s without selecting a fallback',
    async (scenario) => {
      const fixture = await createEphemeralRsaFixture();
      const provider = { load: jest.fn(async () => fixture.privateKey) };
      const repository = {
        findActive: jest.fn(async () => scenario === 'no active row' ? null : keyRow(scenario, fixture))
      };
      const resolver = createResolver(repository, provider);

      await expect(resolver.resolveActiveSigningKey()).rejects.toMatchObject(identityServiceUnavailable());
      expect(provider.load).not.toHaveBeenCalled();
    }
  );

  it('fails closed before provider access for malformed active metadata', async () => {
    const fixture = await createEphemeralRsaFixture();
    const provider = { load: jest.fn(async () => fixture.privateKey) };
    const repository = { findActive: jest.fn(async () => ({ ...keyRow('active', fixture), publicJwk: { ...fixture.publicJwk, kid: 'wrong-kid' } })) };
    const resolver = createResolver(repository, provider);

    await expect(resolver.resolveActiveSigningKey()).rejects.toMatchObject(identityServiceUnavailable());
    expect(provider.load).not.toHaveBeenCalled();
  });
});

type ActiveKeyRepository = Readonly<{ findActive(): Promise<unknown> }>;
type SigningKeyProviderDouble = Readonly<{ load(reference: string): Promise<unknown> }>;

function createResolver(repository: ActiveKeyRepository, provider: SigningKeyProviderDouble) {
  if (!existsSync(resolverPath)) throw new Error('Expected Phase 5 ActiveSigningKeyResolver production surface.');
  const target = require(resolverPath) as {
    ActiveSigningKeyResolver?: new (repository: ActiveKeyRepository, provider: SigningKeyProviderDouble) => {
      resolveActiveSigningKey(): Promise<unknown>;
    };
  };
  if (!target.ActiveSigningKeyResolver) throw new Error('Expected Phase 5 ActiveSigningKeyResolver production surface.');
  return new target.ActiveSigningKeyResolver(repository, provider);
}

function keyRow(status: string, fixture: Awaited<ReturnType<typeof createEphemeralRsaFixture>>) {
  return {
    kid: fixture.kid,
    status,
    keyReference: 'file:/test/gateway-private.pem',
    publicJwk: fixture.publicJwk
  };
}

function identityServiceUnavailable() {
  return {
    status: 503,
    code: 'IDENTITY_SERVICE_UNAVAILABLE',
    message: 'Identity service is unavailable.',
    auditReasonCode: 'signing_or_jwks_unavailable'
  };
}
