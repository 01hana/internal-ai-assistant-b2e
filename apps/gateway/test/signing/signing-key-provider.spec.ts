import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createEphemeralRsaFixture } from './ephemeral-rsa.fixture';

const providerPath = resolve(__dirname, '../../src/signing/signing-key-provider.ts');
const forbiddenRawPrivateKeyIdentifiers = /\b(?:GATEWAY_PRIVATE_KEY(?:_PEM)?|PRIVATE_JWK|JWT_SIGNING_SECRET)\b/;

describe('SigningKeyProvider contract (T045)', () => {
  it('does not introduce raw private-key environment variables', () => {
    const gatewaySource = readTree(resolve(__dirname, '../../src'));
    expect('process.env.GATEWAY_PRIVATE_KEY').toMatch(forbiddenRawPrivateKeyIdentifiers);
    expect('process.env.GATEWAY_PRIVATE_KEY_PEM').toMatch(forbiddenRawPrivateKeyIdentifiers);
    expect('process.env.PRIVATE_JWK').toMatch(forbiddenRawPrivateKeyIdentifiers);
    expect('process.env.JWT_SIGNING_SECRET').toMatch(forbiddenRawPrivateKeyIdentifiers);
    expect('PRIVATE_JWK_MEMBERS').not.toMatch(forbiddenRawPrivateKeyIdentifiers);
    expect(gatewaySource).not.toMatch(forbiddenRawPrivateKeyIdentifiers);
    expect(gatewaySource).toMatch(/GATEWAY_SIGNING_KEY_REFERENCE/);
  });

  it('loads readable RSA local files for file and relative references without exposing private material', async () => {
    const fixture = await createEphemeralRsaFixture();
    const temporaryFile = await fixture.writeTemporaryPem();
    try {
      const provider = createProvider();
      await expect(provider.load(temporaryFile.fileReference)).resolves.toMatchObject({});
      await expect(provider.load(temporaryFile.relativeReference)).resolves.toMatchObject({});
    } finally {
      await temporaryFile.dispose();
    }
  });

  it('fails closed for provider references without an adapter and never exposes reference or parser detail', async () => {
    const provider = createProvider();
    const reference = 'provider://gateway/signing-key';
    await expectIdentityServiceUnavailable(() => provider.load(reference), [reference]);
  });

  it('fails closed for a missing local signing-key file without disclosing its reference', async () => {
    const provider = createProvider();
    const reference = 'file:/definitely/missing/phase5-gateway-private.pem';
    await expectIdentityServiceUnavailable(() => provider.load(reference), [reference, 'phase5-gateway-private.pem']);
  });

  it('fails closed for malformed local signing-key material without disclosing content or parser detail', async () => {
    const fixture = await createEphemeralRsaFixture();
    const material = 'not-a-private-key-phase5-sentinel';
    const temporaryFile = await fixture.writeTemporaryContent(material, 'malformed-private.pem');
    try {
      const provider = createProvider();
      await expectIdentityServiceUnavailable(() => provider.load(temporaryFile.fileReference), [temporaryFile.fileReference, material, 'parser']);
    } finally {
      await temporaryFile.dispose();
    }
  });

  it('fails closed for public-only RSA material that is not usable for private signing', async () => {
    const fixture = await createEphemeralRsaFixture();
    const temporaryFile = await fixture.writeTemporaryContent(fixture.publicPem, 'public-only.pem');
    try {
      const provider = createProvider();
      await expectIdentityServiceUnavailable(() => provider.load(temporaryFile.fileReference), [temporaryFile.fileReference, fixture.publicPem]);
    } finally {
      await temporaryFile.dispose();
    }
  });
});

function createProvider() {
  if (!existsSync(providerPath)) throw new Error('Expected Phase 5 SigningKeyProvider production surface.');
  const target = require(providerPath) as {
    SigningKeyProvider?: new () => { load(reference: string): Promise<unknown> };
  };
  if (!target.SigningKeyProvider) throw new Error('Expected Phase 5 SigningKeyProvider production surface.');
  return new target.SigningKeyProvider();
}

function readTree(directory: string): string {
  const { readdirSync, readFileSync } = require('node:fs') as typeof import('node:fs');
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const entryPath = resolve(directory, entry.name);
      if (entry.isDirectory()) return readTree(entryPath);
      return entry.name.endsWith('.ts') ? [readFileSync(entryPath, 'utf8')] : [];
    })
    .join('\n');
}

async function expectIdentityServiceUnavailable(load: () => Promise<unknown>, hiddenValues: readonly string[]) {
  let failure: unknown;
  try {
    await load();
  } catch (error) {
    failure = error;
  }

  expect(failure).toMatchObject({
    status: 503,
    code: 'IDENTITY_SERVICE_UNAVAILABLE',
    message: 'Identity service is unavailable.',
    auditReasonCode: 'signing_or_jwks_unavailable'
  });
  const serialized = JSON.stringify(failure);
  for (const hiddenValue of hiddenValues) expect(serialized).not.toContain(hiddenValue);
}
