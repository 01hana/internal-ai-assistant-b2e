import { createGatewayPrismaClient } from '../../src/integration-registry/gateway-prisma-client.factory';
import { ManagedHttpMethod, ManagedPermissionMode } from '../../src/generated/prisma/client';
import { createGatewayRegistryDatabase } from '../../../../test/support/gateway-registry-db.helper';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Feature 006 additive enum and persistence contract — failing-first (T002)', () => {
  const schema = () => readFileSync(resolve(__dirname, '../../../../prisma/schema.prisma'), 'utf8');

  it('T002: declares GET and provider_trusted while retaining every existing enum value', () => {
    const value = schema();
    expect(value).toMatch(/enum ManagedHttpMethod\s*\{[^}]*\bPOST\b[^}]*\bGET\b[^}]*\}/s);
    expect(value).toMatch(/enum ManagedPermissionMode\s*\{[^}]*\ballow_empty\b[^}]*\brequired\b[^}]*\bprovider_trusted\b[^}]*\}/s);
  });

  it('keeps Feature 006 persistence free of new Customer/token/raw-payload/SDK authority while allowing Feature 004 binding Customer persistence', () => {
    const value = schema();
    expect(value).toMatch(/model IntegrationBinding[\s\S]*customerId/);
    const feature006 = value.slice(value.indexOf('model ManagedIdentityProviderInstance'), value.indexOf('model ManagedUpstreamIssuer'));
    expect(feature006).not.toMatch(/nativeAccessToken|refreshToken|menuDetail|sdkState|customerId/i);
  });
});

const describeRegistry = process.env.RUN_GATEWAY_REGISTRY_DB_TESTS === 'true' ? describe : describe.skip;

describeRegistry('Managed identity exchange persistence (T003/T004/T006/T007)', () => {
  let database: Awaited<ReturnType<typeof createGatewayRegistryDatabase>>;
  let prisma: ReturnType<typeof createGatewayPrismaClient>;

  beforeEach(async () => {
    database = await createGatewayRegistryDatabase('managed-identity-exchange');
    prisma = createGatewayPrismaClient(database.databaseUrl);
    await prisma.customer.createMany({ data: [{ id: 'customer-a' }, { id: 'customer-b' }] });
    await prisma.integrationBinding.createMany({ data: [
      { integrationId: 'integration-a', customerId: 'customer-a', allowedHostApp: 'admin', enabled: true },
      { integrationId: 'integration-b', customerId: 'customer-b', allowedHostApp: 'admin', enabled: true }
    ] });
  });

  afterEach(async () => {
    await prisma?.$disconnect();
    await database?.dispose();
  });

  it('retains replaced v1 and active v2, while active selector lookup fails closed for the predecessor', async () => {
    const repository = repositoryFor(prisma);
    const provider = await providerFor(prisma);
    await prisma.managedIntegrationExchangeConfig.create({ data: config('config-v1', 'selector-v1', provider.id, 1, false, 'replaced') });
    await prisma.managedIntegrationExchangeConfig.create({ data: config('config-v2', 'selector-v2', provider.id, 2, true, 'active', 'config-v1') });

    await expect(repository.findEnabledActiveByPublicSelector('selector-v1')).resolves.toBeNull();
    await expect(repository.findEnabledActiveByPublicSelector('selector-v2')).resolves.toEqual(expect.objectContaining({ id: 'config-v2', integrationId: 'integration-a' }));
  });

  it('rejects two active configs for one integration and duplicate public selectors globally', async () => {
    const provider = await providerFor(prisma);
    await prisma.managedIntegrationExchangeConfig.create({ data: config('config-a1', 'selector-shared', provider.id, 1, true, 'active') });
    await expect(prisma.managedIntegrationExchangeConfig.create({ data: config('config-a2', 'selector-a2', provider.id, 2, true, 'active') })).rejects.toThrow();
    await expect(prisma.managedIntegrationExchangeConfig.create({ data: { ...config('config-b1', 'selector-shared', provider.id, 1, true, 'active'), integrationId: 'integration-b' } })).rejects.toThrow();
  });

  it('allows historical admission and permission policies but rejects dual active versions', async () => {
    const provider = await providerFor(prisma);
    await prisma.managedIntegrationExchangeConfig.create({ data: config('config-a', 'selector-a', provider.id, 1, true, 'active') });
    await prisma.managedIntegrationAdmissionPolicy.create({ data: admission('admission-v1', 'config-a', 1, false, 'replaced') });
    await prisma.managedIntegrationAdmissionPolicy.create({ data: admission('admission-v2', 'config-a', 2, true, 'active', 'admission-v1') });
    await expect(prisma.managedIntegrationAdmissionPolicy.create({ data: admission('admission-v3', 'config-a', 3, true, 'active') })).rejects.toThrow();
    await prisma.managedPermissionPolicy.create({ data: permission('permission-v1', 'config-a', 1, false, 'replaced') });
    await prisma.managedPermissionPolicy.create({ data: permission('permission-v2', 'config-a', 2, true, 'active', 'permission-v1') });
    await expect(prisma.managedPermissionPolicy.create({ data: permission('permission-v3', 'config-a', 3, true, 'active') })).rejects.toThrow();
  });

  it('enforces one active managed issuer and one active key per issuer', async () => {
    await prisma.managedUpstreamIssuer.create({ data: issuer('issuer-a', 1, true, 'active') });
    await expect(prisma.managedUpstreamIssuer.create({ data: issuer('issuer-b', 1, true, 'active') })).rejects.toThrow();
    await prisma.managedUpstreamSigningKey.create({ data: key('key-a', 'issuer-a', 'managed-kid-a', 1, true) });
    await expect(prisma.managedUpstreamSigningKey.create({ data: key('key-b', 'issuer-a', 'managed-kid-b', 2, true) })).rejects.toThrow();
  });

  it('T007 preserves legacy enum rows and represents additive GET and provider_trusted values', async () => {
    const legacyProvider = await providerFor(prisma);
    await prisma.managedIdentityProviderInstance.create({ data: {
      id: 'provider-get', providerType: 'delegated_http', endpointUri: 'https://provider.example.test/get',
      httpMethod: ManagedHttpMethod.GET, credentialPlacement: 'authorization_bearer', timeoutMilliseconds: 5000,
      responseContractVersion: 'delegated-http/v1', contractConfig: {}, declaredAnchorKinds: ['tenant'], enabled: false, lifecycle: 'draft', version: 2
    } });
    await prisma.managedIntegrationExchangeConfig.create({ data: config('config-enums', 'selector-enums', legacyProvider.id, 1, true, 'active') });
    await prisma.managedPermissionPolicy.create({ data: permission('permission-allow-empty', 'config-enums', 1, true, 'active') });
    await prisma.managedPermissionPolicy.create({ data: {
      ...permission('permission-required', 'config-enums', 2, false, 'replaced', 'permission-allow-empty'),
      mode: ManagedPermissionMode.required
    } });
    await prisma.managedPermissionPolicy.create({ data: {
      ...permission('permission-provider-trusted', 'config-enums', 3, false, 'replaced', 'permission-required'),
      mode: ManagedPermissionMode.provider_trusted
    } });

    await expect(prisma.managedIdentityProviderInstance.findMany({ where: { id: { in: [legacyProvider.id, 'provider-get'] } }, orderBy: { version: 'asc' } })).resolves.toEqual([
      expect.objectContaining({ id: legacyProvider.id, httpMethod: ManagedHttpMethod.POST }),
      expect.objectContaining({ id: 'provider-get', httpMethod: ManagedHttpMethod.GET })
    ]);
    await expect(prisma.managedPermissionPolicy.findMany({ where: { integrationConfigId: 'config-enums' }, orderBy: { version: 'asc' } })).resolves.toEqual([
      expect.objectContaining({ mode: ManagedPermissionMode.allow_empty }),
      expect.objectContaining({ mode: ManagedPermissionMode.required }),
      expect.objectContaining({ mode: ManagedPermissionMode.provider_trusted })
    ]);
    await expect(prisma.integrationBinding.findUnique({ where: { integrationId: 'integration-a' } })).resolves.toMatchObject({ customerId: 'customer-a', allowedHostApp: 'admin', enabled: true });
  });

  it('exposes repository boundaries for every managed record without a Customer lookup', async () => {
    const target = require('../../src/managed-identity-exchange/persistence/managed-exchange.repository') as typeof import('../../src/managed-identity-exchange/persistence/managed-exchange.repository');
    const provider = await providerFor(prisma);
    await prisma.managedIntegrationExchangeConfig.create({ data: config('config-a', 'selector-a', provider.id, 1, true, 'active') });
    await prisma.managedIntegrationAdmissionPolicy.create({ data: admission('admission-a', 'config-a', 1, true, 'active') });
    await prisma.managedPermissionSourceInstance.create({ data: { id: 'source-a', sourceType: 'synthetic', endpointUri: null, providerInstanceId: provider.id, serviceCredentialReference: 'ref-a', adapterContractReference: 'synthetic/v1', contractConfig: {}, enabled: true, lifecycle: 'active', version: 1, replacesSourceId: null } });
    await prisma.managedPermissionPolicy.create({ data: { ...permission('permission-a', 'config-a', 1, true, 'active'), permissionSourceInstanceId: 'source-a' } });
    await prisma.managedUpstreamIssuer.create({ data: issuer('issuer-a', 1, true, 'active') });
    await prisma.managedUpstreamSigningKey.create({ data: key('key-a', 'issuer-a', 'managed-kid-a', 1, true) });

    await expect(new target.ManagedIdentityProviderInstanceRepository(prisma).findEnabledActiveById(provider.id)).resolves.toMatchObject({ id: provider.id });
    await expect(new target.ManagedIntegrationExchangeConfigRepository(prisma).findEnabledActiveByPublicSelector('selector-a')).resolves.toMatchObject({ integrationId: 'integration-a' });
    await expect(new target.ManagedIntegrationAdmissionPolicyRepository(prisma).findEnabledActiveByConfigId('config-a')).resolves.toHaveLength(1);
    await expect(new target.ManagedPermissionSourceInstanceRepository(prisma).findEnabledActiveById('source-a')).resolves.toMatchObject({ id: 'source-a' });
    await expect(new target.ManagedPermissionPolicyRepository(prisma).findEnabledActiveByConfigId('config-a')).resolves.toHaveLength(1);
    await expect(new target.ManagedUpstreamIssuerRepository(prisma).findEnabledActive()).resolves.toHaveLength(1);
    await expect(new target.ManagedUpstreamSigningKeyRepository(prisma).findEnabledActiveByIssuerId('issuer-a')).resolves.toHaveLength(1);
    await expect(new target.ManagedExchangeAuditRepository(prisma).append({ requestId: 'request-a', outcome: 'success', reasonCode: 'verified', integrationId: 'integration-a' })).resolves.toMatchObject({ requestId: 'request-a' });
  });
});

function repositoryFor(prisma: ReturnType<typeof createGatewayPrismaClient>) {
  const target = require('../../src/managed-identity-exchange/persistence/managed-exchange.repository') as typeof import('../../src/managed-identity-exchange/persistence/managed-exchange.repository');
  return new target.ManagedIntegrationExchangeConfigRepository(prisma);
}

async function providerFor(prisma: ReturnType<typeof createGatewayPrismaClient>) {
  return prisma.managedIdentityProviderInstance.create({ data: {
    id: `provider-${Math.random().toString(16).slice(2)}`, providerType: 'delegated_http', endpointUri: 'https://provider.example.test/verify',
    httpMethod: 'POST', credentialPlacement: 'authorization_bearer', timeoutMilliseconds: 5000, responseContractVersion: 'delegated-http/v1',
    contractConfig: {}, declaredAnchorKinds: ['tenant'], enabled: true, lifecycle: 'active', version: 1
  } });
}

function config(id: string, publicSelector: string, providerInstanceId: string, version: number, enabled: boolean, lifecycle: 'active' | 'replaced', replacesConfigId: string | null = null) {
  return { id, publicSelector, integrationId: 'integration-a', providerInstanceId, canonicalHostApp: 'admin', organizationMode: 'verified' as const, fixedOrganizationId: null, enabled, lifecycle, version, replacesConfigId };
}

function admission(id: string, integrationConfigId: string, version: number, enabled: boolean, lifecycle: 'active' | 'replaced', replacesPolicyId: string | null = null) {
  return { id, integrationConfigId, anchorRequirements: [], enabled, lifecycle, version, replacesPolicyId };
}

function permission(id: string, integrationConfigId: string, version: number, enabled: boolean, lifecycle: 'active' | 'replaced', replacesPolicyId: string | null = null) {
  return { id, integrationConfigId, mode: 'allow_empty' as const, permissionSourceInstanceId: null, normalizerType: null, projectionContractVersion: null, enabled, lifecycle, version, replacesPolicyId };
}

function issuer(id: string, version: number, enabled: boolean, lifecycle: 'active' | 'replaced') {
  return { id, issuer: `https://${id}.example.test`, expectedAudience: 'managed-audience', publicJwksUri: `https://${id}.example.test/jwks.json`, enabled, lifecycle, version, replacesIssuerId: null };
}

function key(id: string, issuerId: string, kid: string, version: number, active: boolean) {
  return { id, issuerId, kid, publicJwk: { kty: 'RSA', n: 'public', e: 'AQAB' }, keyReference: `ref:${id}`, status: active ? 'active' as const : 'published' as const, enabled: active, lifecycle: active ? 'active' as const : 'draft' as const, version, replacesKeyId: null, notBefore: null, activatedAt: null, retireAfter: null, retiredAt: null };
}
