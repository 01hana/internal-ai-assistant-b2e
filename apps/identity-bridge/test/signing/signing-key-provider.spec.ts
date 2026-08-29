import { generateKeyPairSync } from 'node:crypto';
import { SignJWT } from 'jose';
import { BridgeSigningError, SigningKeyProvider } from '../../src/signing/signing-key.provider';
import { fileReference, rsaSigningFixture, temporaryPemFile } from './signing-fixtures';

type InvalidPemCase = readonly [string, () => string | Buffer, string];

const invalidPemCases: readonly InvalidPemCase[] = [
  ['empty file', () => '', 'empty-key-sentinel'],
  ['malformed PKCS#8', () => '-----BEGIN PRIVATE KEY-----\nmalformed-key-sentinel\n-----END PRIVATE KEY-----', 'malformed-key-sentinel'],
  ['SPKI public key', () => generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ type: 'spki', format: 'pem' }), 'PUBLIC KEY'],
  ['EC PKCS#8 private key', () => generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ type: 'pkcs8', format: 'pem' }), 'PRIVATE KEY'],
  ['RSA PKCS#1 private key', () => generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' }), 'RSA PRIVATE KEY'],
  ['encrypted PKCS#8 private key', () => generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: 'encrypted-key-sentinel' }), 'ENCRYPTED PRIVATE KEY'],
  ['unknown PEM envelope', () => '-----BEGIN UNKNOWN KEY-----\ndW5rbm93bi1rZXktc2VudGluZWw=\n-----END UNKNOWN KEY-----', 'unknown-key-sentinel'],
  ['multiple PEM blocks', () => `${rsaPem()}\n${rsaPem()}`, 'multiple-key-sentinel']
];

describe('Customer-local PKCS#8 RSA signing key provider', () => {
  it('loads a file-backed RSA PKCS#8 key usable for RS256', async () => {
    const fixture = rsaSigningFixture();
    const key = await new SigningKeyProvider().load(fixture.reference);
    await expect(new SignJWT({}).setProtectedHeader({ alg: 'RS256' }).sign(key)).resolves.toEqual(expect.any(String));
  });

  it.each([
    'file:/missing/key-reference-sentinel.pem',
    'file:',
    'https://keys.test/key-reference-sentinel',
    'kms://key-reference-sentinel',
    'provider://key-reference-sentinel',
    'plain-key-reference-sentinel'
  ])('rejects non-loadable reference without disclosure: %s', async (reference) => {
    const error = await captureError(() => new SigningKeyProvider().load(reference));
    assertSafeSigningError(error, [reference, 'key-reference-sentinel']);
  });

  it.each(invalidPemCases)('rejects %s with the generic safe classification', async (name, createPem, sentinel) => {
    const pem = createPem();
    const file = temporaryPemFile(pem, `invalid-${name.replaceAll(' ', '-')}`);
    const reference = fileReference(file);
    const error = await captureError(() => new SigningKeyProvider().load(reference));
    assertSafeSigningError(error, [reference, file, sentinel, String(pem)]);
  });
});

async function captureError(action: () => Promise<unknown>): Promise<unknown> {
  try {
    await action();
    throw new Error('Expected signing operation to reject.');
  } catch (error) {
    return error;
  }
}

function assertSafeSigningError(error: unknown, forbidden: readonly string[]): void {
  expect(error).toBeInstanceOf(BridgeSigningError);
  expect(error).toHaveProperty('message', 'Bridge signing failed: bridge_signing_invalid.');
  const serialized = `${String(error)}${JSON.stringify(error)}`;
  for (const value of forbidden) if (value) expect(serialized).not.toContain(value);
}

function rsaPem(): string {
  return generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
}
