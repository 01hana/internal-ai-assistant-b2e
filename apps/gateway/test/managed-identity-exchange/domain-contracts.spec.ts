import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PermissionSourcePolicy, ProviderInstancePolicy, ResolvePermissionInput, VerifyNativeCredentialInput } from '../../src/managed-identity-exchange/domain/managed-exchange.domain';

const domainPath = resolve(__dirname, '../../src/managed-identity-exchange/domain/managed-exchange.domain.ts');
const schemaPath = resolve(__dirname, '../../../../prisma/schema.prisma');

describe('Managed identity exchange domain contracts (T001)', () => {
  it('provides immutable, provider-neutral identity values without native credential authority', () => {
    expect(existsSync(domainPath)).toBe(true);
    const domain = require(domainPath) as typeof import('../../src/managed-identity-exchange/domain/managed-exchange.domain');
    const identity = domain.createVerifiedExternalIdentity({
      subject: 'actor-a', organization: 'org-a', anchors: [{ kind: 'tenant', value: 'tenant-a' }],
      trustedPermissionReference: 'permission-ref-a', providerSubjectReference: 'provider-subject-ref-a'
    });

    expect(Object.isFrozen(identity)).toBe(true);
    expect(Object.isFrozen(identity.anchors)).toBe(true);
    expect(identity).toEqual(expect.objectContaining({ subject: 'actor-a', organization: 'org-a' }));
    expect(JSON.stringify(identity)).not.toMatch(/nativeCredential|authorization|token|customerId/i);
    expect(() => domain.createVerifiedExternalIdentity({ subject: 'actor-a', anchors: [{ kind: 'tenant', value: 'tenant-a' }], nativeCredential: 'secret' } as never)).toThrow();
  });

  it('keeps selectors opaque lookup values and declares strict future exchange request/error shapes', () => {
    const domain = require(domainPath) as typeof import('../../src/managed-identity-exchange/domain/managed-exchange.domain');
    expect(domain.createPublicSelector('selector-a')).toEqual('selector-a');
    expect(() => domain.createPublicSelector('  ')).toThrow();
    expect(domain.EXCHANGE_REQUEST_FIELDS).toEqual(['integrationSelector']);
    expect(domain.EXCHANGE_PUBLIC_ERROR_CODES).toEqual([
      'EXCHANGE_REQUEST_INVALID', 'EXCHANGE_IDENTITY_INVALID', 'EXCHANGE_IDENTITY_DENIED', 'EXCHANGE_SERVICE_UNAVAILABLE'
    ]);
  });

  it('supplies every provider adapter runtime input through a server-owned policy', () => {
    const domain = require(domainPath) as typeof import('../../src/managed-identity-exchange/domain/managed-exchange.domain');
    const policy: ProviderInstancePolicy = {
      id: 'provider-a', providerType: 'delegated-http', endpointUri: 'https://provider.example.test/verify',
      httpMethod: 'POST', credentialPlacement: 'authorization_bearer', timeoutMilliseconds: 5000,
      responseContractVersion: 'delegated-http/v1', declaredAnchorKinds: Object.freeze(['tenant']),
      providerContract: Object.freeze({ responseShape: 'verified-identity-v1' })
    };
    const input: VerifyNativeCredentialInput = { nativeCredential: 'opaque-native-credential', providerInstancePolicy: policy, requestId: 'request-a' };

    expect(input.providerInstancePolicy).toEqual(expect.objectContaining({
      endpointUri: 'https://provider.example.test/verify', httpMethod: 'POST', credentialPlacement: 'authorization_bearer',
      timeoutMilliseconds: 5000, responseContractVersion: 'delegated-http/v1', providerContract: { responseShape: 'verified-identity-v1' }
    }));
    expect(JSON.stringify(policy)).not.toMatch(/customerId|nativeCredential|authorization\s*:|privateKey|secret/i);
  });

  it('supplies every permission adapter runtime input through a server-owned source policy', () => {
    const domain = require(domainPath) as typeof import('../../src/managed-identity-exchange/domain/managed-exchange.domain');
    const policy: PermissionSourcePolicy = {
      id: 'source-a', sourceType: 'synthetic', endpointUri: 'https://permissions.example.test/resolve',
      adapterContractReference: 'synthetic/v1', sourceContract: Object.freeze({ responseShape: 'permission-v1' }),
      serviceCredentialReference: 'deployment-secret-reference'
    };
    const input: ResolvePermissionInput = {
      admittedIdentity: domain.createVerifiedExternalIdentity({ subject: 'actor-a', anchors: [{ kind: 'tenant', value: 'tenant-a' }] }),
      serverOwnedIntegrationContext: { integrationId: 'integration-a', hostApp: 'admin' }, permissionSourcePolicy: policy, requestId: 'request-a'
    };

    expect(input.permissionSourcePolicy).toEqual(expect.objectContaining({
      endpointUri: 'https://permissions.example.test/resolve', adapterContractReference: 'synthetic/v1',
      sourceContract: { responseShape: 'permission-v1' }, serviceCredentialReference: 'deployment-secret-reference'
    }));
    expect(JSON.stringify(policy)).not.toMatch(/customerId|nativeCredential|authorization\s*:|privateKey|secret(?!-reference)/i);
  });

  it('keeps the domain free of Customer, Prisma, IDX, Gateway signer, and Feature 004 runtime authority', () => {
    expect(existsSync(domainPath)).toBe(true);
    const source = readFileSync(domainPath, 'utf8');
    expect(source).not.toMatch(/from ['"][^'"]*(prisma|customer|gateway-signing|canonical-identity-resolver|multi-profile-upstream-token-verifier|idx)[^'"]*['"]/i);
    expect(source).not.toMatch(/GatewaySigningKey|customerId|CanonicalIdentityResolver|MultiProfileUpstreamTokenVerifier/);
    expect(source).toMatch(/IdentityProviderAdapter/);
    expect(source).toMatch(/PermissionSourceAdapter/);
    expect(source).toMatch(/ManagedTokenIssuer/);
  });

  it('keeps Feature 005 persistence separate from Customer, credentials, JWTs, private keys, and Gateway signer records', () => {
    const schema = readFileSync(schemaPath, 'utf8');
    for (const name of [
      'ManagedIdentityProviderInstance', 'ManagedIntegrationExchangeConfig', 'ManagedIntegrationAdmissionPolicy',
      'ManagedPermissionSourceInstance', 'ManagedPermissionPolicy', 'ManagedUpstreamIssuer',
      'ManagedUpstreamSigningKey', 'ManagedExchangeAuditEvent'
    ]) {
      const body = model(schema, name);
      expect(body).not.toMatch(/customerId|\bcustomer\s+Customer|nativeCredential|authorization|accessToken|refreshToken|privateKey/i);
      expect(body).not.toMatch(/GatewaySigningKey/);
    }
  });
});

function model(schema: string, name: string): string {
  const match = schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`));
  if (!match) throw new Error(`Missing Prisma model ${name}.`);
  return match[1];
}
