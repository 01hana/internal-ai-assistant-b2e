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
      id: 'source-a', sourceType: 'synthetic', adapterContractReference: 'synthetic/v1'
    };
    const input: ResolvePermissionInput = {
      admittedIdentity: domain.createVerifiedExternalIdentity({ subject: 'actor-a', anchors: [{ kind: 'tenant', value: 'tenant-a' }] }),
      serverOwnedIntegrationContext: { integrationId: 'integration-a', hostApp: 'admin' }, serviceCredentialReference: 'deployment-secret-reference',
      permissionSourcePolicy: policy, requestId: 'request-a'
    };

    expect(Object.keys(input.permissionSourcePolicy).sort()).toEqual(['adapterContractReference', 'id', 'sourceType']);
    expect(input.serviceCredentialReference).toBe('deployment-secret-reference');
    expect(JSON.stringify(input)).not.toMatch(/customerId|nativeCredential|authorization\s*:|privateKey|secret(?!-reference)/i);
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

  it('T020 accepts, copies, and deeply freezes only closed IDX semantic menu material', () => {
    const domain = require(domainPath) as typeof import('../../src/managed-identity-exchange/domain/managed-exchange.domain');
    const actions = ['read', 'update', 'export', 'approval'];
    const menu = { menuId: ' SCM_ORDERS ', actions };
    const menus = [menu, { menuId: 'SCM_ORDERS', actions: ['read'] }];
    const identity = domain.createVerifiedExternalIdentity({ subject: 'actor-a', anchors: [{ kind: 'idx_entry', value: 'entry-a' }], trustedPermissionMaterial: { kind: 'idx-menu-detail/v1', menus } as never });

    expect(identity.trustedPermissionMaterial).toEqual({ kind: 'idx-menu-detail/v1', menus: [{ menuId: 'SCM_ORDERS', actions: ['read', 'update', 'export', 'approval'] }, { menuId: 'SCM_ORDERS', actions: ['read'] }] });
    const material = identity.trustedPermissionMaterial as unknown as { menus: readonly { menuId: string; actions: readonly string[] }[] };
    expect(Object.isFrozen(identity.trustedPermissionMaterial)).toBe(true);
    expect(Object.isFrozen(material.menus)).toBe(true);
    expect(Object.isFrozen(material.menus[0])).toBe(true);
    expect(Object.isFrozen(material.menus[0].actions)).toBe(true);
    actions.push('delete'); menu.menuId = 'MUTATED'; menus.push({ menuId: 'MUTATED', actions: ['read'] });
    expect(material.menus).toEqual([{ menuId: 'SCM_ORDERS', actions: ['read', 'update', 'export', 'approval'] }, { menuId: 'SCM_ORDERS', actions: ['read'] }]);
  });

  it('T020 accepts authoritative empty IDX menus and preserves scalar Feature 005 material', () => {
    const domain = require(domainPath) as typeof import('../../src/managed-identity-exchange/domain/managed-exchange.domain');
    const empty = domain.createVerifiedExternalIdentity({ subject: 'actor-a', anchors: [{ kind: 'idx_entry', value: 'entry-a' }], trustedPermissionMaterial: { kind: 'idx-menu-detail/v1', menus: [] } as never });
    const scalar = domain.createVerifiedExternalIdentity({ subject: 'actor-a', anchors: [{ kind: 'tenant', value: 'tenant-a' }], trustedPermissionMaterial: { kind: 'managed-permission-material/v1', reference: 'permission-reference', values: ['orders:read'] } });
    expect(empty.trustedPermissionMaterial).toEqual({ kind: 'idx-menu-detail/v1', menus: [] });
    expect(Object.isFrozen((empty.trustedPermissionMaterial as unknown as { menus: unknown[] }).menus)).toBe(true);
    expect(scalar.trustedPermissionMaterial).toEqual({ kind: 'managed-permission-material/v1', reference: 'permission-reference', values: ['orders:read'] });
    expect(Object.isFrozen(scalar.trustedPermissionMaterial?.values)).toBe(true);
  });

  it.each([
    { kind: 'idx-menu-detail/v1', menus: [], reference: 'x' }, { kind: 'idx-menu-detail/v1', menus: [], values: ['orders:read'] },
    { kind: 'idx-menu-detail/v1', menus: [], UUID: 'raw' }, { kind: 'idx-menu-detail/v1', menus: [], nativeCredential: 'raw' },
    { kind: 'idx-menu-detail/v1', menus: [], Authorization: 'Bearer raw' }, { kind: 'idx-menu-detail/v1', menus: [], token: 'raw' },
    { kind: 'idx-menu-detail/v1', menus: [], claims: {} }, { kind: 'idx-menu-detail/v1', menus: [], body: {} }, { kind: 'idx-menu-detail/v1', menus: [], httpStatus: 200 },
    { kind: 'idx-menu-detail/v1', menus: [], customerId: 'customer' }, { kind: 'idx-menu-detail/v1', menus: [], integrationId: 'integration' },
    { kind: 'some-other-provider/v1', menus: [] }, null, [], 'material',
  ])('T020 rejects closed-material hybrids, wrong kinds, and malformed material %o', (trustedPermissionMaterial) => {
    expectIdxMaterialFailure(trustedPermissionMaterial);
  });

  it.each([
    { menuId: '', actions: ['read'] }, { menuId: '   ', actions: ['read'] }, { menuId: 7, actions: ['read'] }, { menuId: 'BAD\u0000ID', actions: ['read'] },
    { menuId: 'ORDERS', actions: 'read' }, { menuId: 'ORDERS', actions: [] }, { menuId: 'ORDERS', actions: ['update'] },
    { menuId: 'ORDERS', actions: ['read', 'read'] }, { menuId: 'ORDERS', actions: ['update', 'read'] }, { menuId: 'ORDERS', actions: ['read', 'approval', 'update'] },
    { menuId: 'ORDERS', actions: ['read', 'READ'] }, { menuId: 'ORDERS', actions: ['read', 'write'] }, { menuId: 'ORDERS', actions: ['read', null] },
    { menuId: 'ORDERS', actions: ['read'], UUID_Menu: 'raw' }, null, [], 7,
  ])('T020 rejects malformed, raw, or non-canonical IDX menu record %o', (menu) => {
    expectIdxMaterialFailure({ kind: 'idx-menu-detail/v1', menus: [menu] });
  });

  it('T020 rejects symbol keys and non-plain IDX material objects', () => {
    const symbolMaterial = { kind: 'idx-menu-detail/v1', menus: [], [Symbol('raw')]: true };
    const nonPlain = Object.assign(Object.create({ inherited: true }), { kind: 'idx-menu-detail/v1', menus: [] });
    expectIdxMaterialFailure(symbolMaterial);
    expectIdxMaterialFailure(nonPlain);
  });
});

function expectIdxMaterialFailure(trustedPermissionMaterial: unknown): void {
  const domain = require(domainPath) as typeof import('../../src/managed-identity-exchange/domain/managed-exchange.domain');
  expect(() => domain.createVerifiedExternalIdentity({ subject: 'actor-a', anchors: [{ kind: 'idx_entry', value: 'entry-a' }], trustedPermissionMaterial } as never)).toThrow(domain.ManagedExchangeCredentialError);
}

function model(schema: string, name: string): string {
  const match = schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`));
  if (!match) throw new Error(`Missing Prisma model ${name}.`);
  return match[1];
}
