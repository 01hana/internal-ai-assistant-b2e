import { ActiveKeyResolver } from '../../src/signing/active-key.resolver';
import { rsaSigningFixture, signingConfig } from './signing-fixtures';

const invalidPublicJwkCases: readonly Readonly<{ name: string; change: Record<string, unknown>; remove?: string }>[] = [
  { name: 'non-RSA kty', change: { kty: 'EC' } },
  { name: 'non-RS256 alg', change: { alg: 'RS512' } },
  { name: 'non-signing use', change: { use: 'enc' } },
  { name: 'mismatched JWK kid', change: { kid: 'different-kid' } },
  { name: 'missing modulus', change: {}, remove: 'n' },
  { name: 'blank modulus', change: { n: '' } },
  { name: 'missing exponent', change: {}, remove: 'e' },
  { name: 'blank exponent', change: { e: '' } }
];

describe('active Bridge signing key resolver', () => {
  it('accepts one matching RSA private/public key and returns public fields only', async () => {
    const fixture = rsaSigningFixture();
    const resolved = await new ActiveKeyResolver(signingConfig([fixture.record])).resolve();
    expect(resolved).toMatchObject({ kid: 'bridge-kid', publicJwk: { kty: 'RSA', alg: 'RS256', use: 'sig' } });
    expect(Object.keys(resolved.publicJwk).sort()).toEqual(['alg', 'e', 'kid', 'kty', 'n', 'use']);
    for (const privateMember of ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k']) expect(resolved.publicJwk).not.toHaveProperty(privateMember);
  });

  it('rejects zero active keys', async () => {
    const fixture = rsaSigningFixture();
    const config = signingConfig([{ ...fixture.record, status: 'published' }]);
    expect(config.isValid).toBe(true);
    await expect(new ActiveKeyResolver(config).resolve()).rejects.toThrow('bridge_signing_invalid');
  });

  it('rejects multiple active keys', async () => {
    const first = rsaSigningFixture('first-kid');
    const second = rsaSigningFixture('second-kid');
    const config = signingConfig([first.record, second.record]);
    expect(config.isValid).toBe(true);
    await expect(new ActiveKeyResolver(config).resolve()).rejects.toThrow('bridge_signing_invalid');
  });

  it('rejects an active key without a key reference', async () => {
    const fixture = rsaSigningFixture();
    const { keyReference: _omitted, ...withoutReference } = fixture.record;
    const config = signingConfig([withoutReference]);
    expect(config.isValid).toBe(true);
    await expect(new ActiveKeyResolver(config).resolve()).rejects.toThrow('bridge_signing_invalid');
  });

  it.each(invalidPublicJwkCases)('rejects $name at the resolver boundary', async ({ change, remove }) => {
    const fixture = rsaSigningFixture();
    const publicJwk: Record<string, unknown> = { ...fixture.record.publicJwk, ...change };
    if (remove) delete publicJwk[remove];
    const config = signingConfig([{ ...fixture.record, publicJwk }]);
    expect(config.isValid).toBe(true);
    await expect(new ActiveKeyResolver(config).resolve()).rejects.toThrow('bridge_signing_invalid');
  });

  it('rejects a configured public key that does not match the active private key', async () => {
    const privateA = rsaSigningFixture('shared-kid');
    const publicB = rsaSigningFixture('shared-kid');
    const config = signingConfig([{ ...privateA.record, publicJwk: publicB.record.publicJwk }]);
    expect(config.isValid).toBe(true);
    await expect(new ActiveKeyResolver(config).resolve()).rejects.toThrow('bridge_signing_invalid');
  });

  it('rejects duplicate kids at the configuration boundary', () => {
    const fixture = rsaSigningFixture();
    const config = signingConfig([fixture.record, { ...fixture.record, status: 'published' }]);
    expect(config.validation).toEqual({ ok: false, category: 'signing_keys' });
  });

  it.each(['https://keys.test/key', 'kms://key', 'provider://key', 'plain-secret'])('rejects non-file reference at the configuration boundary: %s', (keyReference) => {
    const fixture = rsaSigningFixture();
    const config = signingConfig([{ ...fixture.record, keyReference }]);
    expect(config.validation).toEqual({ ok: false, category: 'signing_keys' });
  });

  it.each(['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k'])('rejects private JWK member %s at the configuration boundary', (member) => {
    const fixture = rsaSigningFixture();
    const config = signingConfig([{ ...fixture.record, publicJwk: { ...fixture.record.publicJwk, [member]: 'private-jwk-sentinel' } }]);
    expect(config.validation).toEqual({ ok: false, category: 'signing_keys' });
  });
});
