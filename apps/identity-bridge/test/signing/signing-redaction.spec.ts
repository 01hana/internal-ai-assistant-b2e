import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ActiveKeyResolver } from '../../src/signing/active-key.resolver';
import { CanonicalTokenIssuer } from '../../src/signing/canonical-token.issuer';
import { BridgeSigningError, SigningKeyProvider } from '../../src/signing/signing-key.provider';
import { fileReference, rsaSigningFixture, signingConfig, temporaryPemFile } from './signing-fixtures';

const signingSource = ['signing-key.provider.ts', 'active-key.resolver.ts', 'canonical-token.issuer.ts']
  .map((file) => readFileSync(join(__dirname, '../../src/signing', file), 'utf8'))
  .join('\n');

describe('Bridge signing redaction boundary', () => {
  it('redacts representative key-provider failures', async () => {
    const malformed = '-----BEGIN PRIVATE KEY-----\nmalformed-redaction-sentinel\n-----END PRIVATE KEY-----';
    const pkcs1 = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' });
    const ec = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ type: 'pkcs8', format: 'pem' });
    const references = [
      'file:/missing/redaction-reference-sentinel.pem',
      fileReference(temporaryPemFile(malformed, 'malformed-redaction-sentinel')),
      fileReference(temporaryPemFile(pkcs1, 'pkcs1-redaction-sentinel')),
      fileReference(temporaryPemFile(ec, 'ec-redaction-sentinel'))
    ];

    for (const reference of references) {
      const error = await captureError(() => new SigningKeyProvider().load(reference));
      assertGeneric(error, [reference, 'redaction-sentinel', malformed, String(pkcs1), String(ec), 'prime256v1', 'ec']);
    }
  });

  it('redacts private/public mismatch and invalid public metadata failures', async () => {
    const privateA = rsaSigningFixture('redaction-kid');
    const publicB = rsaSigningFixture('redaction-kid');
    const mismatch = signingConfig([{ ...privateA.record, publicJwk: publicB.record.publicJwk }]);
    const mismatchError = await captureError(() => new ActiveKeyResolver(mismatch).resolve());
    assertGeneric(mismatchError, [privateA.reference, privateA.file, 'redaction-kid', String(privateA.record.publicJwk.n), String(publicB.record.publicJwk.n)]);

    const invalidMetadata = signingConfig([{ ...privateA.record, publicJwk: { ...privateA.record.publicJwk, alg: 'invalid-algorithm-sentinel' } }]);
    const metadataError = await captureError(() => new ActiveKeyResolver(invalidMetadata).resolve());
    assertGeneric(metadataError, [privateA.reference, privateA.file, 'redaction-kid', 'invalid-algorithm-sentinel']);
  });

  it('redacts issuer input when issuance fails', async () => {
    const fixture = rsaSigningFixture();
    const config = signingConfig([fixture.record]);
    const invalidUuid = (() => 'invalid-uuid-redaction-sentinel') as unknown as typeof randomUUID;
    const issuer = new CanonicalTokenIssuer(config, new ActiveKeyResolver(config), () => 1000, invalidUuid);
    const error = await captureError(() => issuer.issue({
      identity: {
        subject: 'native-subject-redaction-sentinel',
        organization: 'native-organization-redaction-sentinel',
        entry: 'native-entry-redaction-sentinel'
      },
      permissionScopes: ['menu:REDACTION-SENTINEL:read']
    }));
    assertGeneric(error, ['invalid-uuid-redaction-sentinel', 'native-subject-redaction-sentinel', 'native-organization-redaction-sentinel', 'native-entry-redaction-sentinel', 'REDACTION-SENTINEL']);
  });

  it('does not import or duplicate central signing authority', () => {
    expect(signingSource).not.toMatch(/GatewaySigning|InternalIdentityTokenIssuer|ManagedUpstreamTokenIssuer|ManagedIdentityExchangeModule|Prisma|CustomerScope|IntegrationBinding|JWKS|exchange/i);
  });

  it('does not log, persist, audit, trace, or write canonical tokens', () => {
    expect(signingSource).not.toMatch(/console\.|logger\.|writeFile|appendFile|telemetry|trace\(|audit|persist/i);
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

function assertGeneric(error: unknown, forbidden: readonly string[]): void {
  expect(error).toBeInstanceOf(BridgeSigningError);
  expect(error).toHaveProperty('message', 'Bridge signing failed: bridge_signing_invalid.');
  const serialized = `${String(error)}${JSON.stringify(error)}`;
  for (const value of forbidden) if (value) expect(serialized).not.toContain(value);
}
