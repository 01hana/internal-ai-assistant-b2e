import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BridgeConfigService, type SigningKeyConfig } from '../../src/config/bridge-config.service';

export type RsaSigningFixture = Readonly<{
  file: string;
  reference: string;
  record: SigningKeyConfig;
}>;

export function temporaryPemFile(pem: string | Buffer, label = 'key'): string {
  const directory = mkdtempSync(join(tmpdir(), `bridge-${label}-`));
  const file = join(directory, `${label}.pem`);
  writeFileSync(file, pem);
  return file;
}

export function fileReference(file: string): string {
  return pathToFileURL(file).toString();
}

export function rsaSigningFixture(kid = 'bridge-kid'): RsaSigningFixture {
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const file = temporaryPemFile(keys.privateKey.export({ type: 'pkcs8', format: 'pem' }), 'rsa-pkcs8');
  const exported = keys.publicKey.export({ format: 'jwk' });
  const publicJwk = Object.freeze({
    kty: 'RSA',
    kid,
    alg: 'RS256',
    use: 'sig',
    n: exported.n,
    e: exported.e
  });
  return Object.freeze({
    file,
    reference: fileReference(file),
    record: Object.freeze({ kid, status: 'active' as const, publicJwk, keyReference: fileReference(file) })
  });
}

export function bridgeEnvironment(signingKeys: readonly Record<string, unknown>[]): Record<string, unknown> {
  return {
    BRIDGE_IDX_MENUDETAIL_URI: 'https://idx.test/menu-detail',
    BRIDGE_IDX_ALLOWED_ENTRY: 'configured-entry',
    BRIDGE_INTEGRATION_ID: 'configured-integration',
    BRIDGE_HOST_APP: 'configured-host-app',
    BRIDGE_ISSUER: 'https://bridge.test',
    BRIDGE_AUDIENCE: 'configured-audience',
    BRIDGE_JWKS_PUBLIC_URI: 'https://bridge.test/.well-known/jwks.json',
    BRIDGE_SIGNING_KEYS: JSON.stringify(signingKeys),
    IDX_DESTINATION_MODE: 'public_only',
    BRIDGE_TIMEOUT_MS: '5000',
    BRIDGE_MAX_RESPONSE_BYTES: '262144'
  };
}

export function signingConfig(signingKeys: readonly Record<string, unknown>[]): BridgeConfigService {
  return new BridgeConfigService(bridgeEnvironment(signingKeys));
}
