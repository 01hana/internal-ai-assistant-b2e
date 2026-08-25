import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createVerifiedExternalIdentity, ManagedExchangeIdentityDeniedError, ManagedExchangeInfrastructureError, type NormalizedPermission, type ResolvePermissionInput, type TrustedPermissionMaterial, type VerifiedExternalIdentity } from '../../src/managed-identity-exchange/domain/managed-exchange.domain';

const servicePath = resolve(__dirname, '../../src/managed-identity-exchange/permissions/managed-permission.service.ts');

type Policy = Readonly<{
  integrationConfigId: string;
  mode: 'allow_empty' | 'required' | 'provider_trusted';
  permissionSourceInstanceId: string | null;
  normalizerType: string | null;
  projectionContractVersion: string | null;
  projectionContract: Readonly<Record<string, unknown>> | null;
}>;
type Source = Readonly<{
  id: string;
  sourceType: string;
  serviceCredentialReference: string | null;
  adapterContractReference: string;
}>;
type Dependencies = Readonly<{
  permissionSources: Readonly<{ findEnabledActiveById(id: string): Promise<Source | null> }>;
  permissionAdapters: Readonly<{ execute(input: unknown): Promise<unknown> }>;
  permissionNormalizers: Readonly<{ resolve(type: string): Readonly<{ normalize(material: TrustedPermissionMaterial): readonly NormalizedPermission[] }> | undefined }>;
  projector: Readonly<{ project(permissions: readonly NormalizedPermission[], version: string, contract: Readonly<Record<string, unknown>>): readonly string[] }>;
}>;
type FuturePipeline = Readonly<{
  resolve(input: Readonly<{
    admittedIdentity: VerifiedExternalIdentity;
    integrationConfigId: string;
    serverOwnedIntegrationContext: Readonly<{ integrationId: string; hostApp: string }>;
    requestId: string;
    policy: Policy;
  }>): Promise<readonly string[]>;
}>;

describe('Managed permission pipeline semantics (T026 / T027)', () => {
  it('T003 EXPECTED_RED: resolves IDX provider_trusted material without selecting a Permission Source', async () => {
    const fixture = createFixture({
      policy: policy({ mode: 'provider_trusted', permissionSourceInstanceId: null, normalizerType: 'idx-menu-detail/v1', projectionContractVersion: 'managed-permissions/v1', projectionContract: Object.freeze({ scopeSchema: 'managed-normalized-scopes/v1' }) })
    });
    const admittedIdentity = createVerifiedExternalIdentity({
      subject: 'actor-a', anchors: [{ kind: 'idx_entry', value: 'entry-a' }],
      trustedPermissionMaterial: { kind: 'idx-menu-detail/v1', menus: [{ menuId: 'ORDERS', actions: ['read'] }] } as unknown as TrustedPermissionMaterial
    });
    const scopes = await pipeline(fixture).resolve({ ...input(fixture.policy), admittedIdentity });
    expect(scopes).toEqual(['orders:read']);
    expect(fixture.permissionSources.findEnabledActiveById).not.toHaveBeenCalled();
    expect(fixture.adapter.execute).not.toHaveBeenCalled();
    expect(fixture.normalizer!.normalize).toHaveBeenCalledTimes(1);
    expect(fixture.projector.project).toHaveBeenCalledTimes(1);
  });

  it.each([
    undefined,
    { kind: 'wrong-material/v1', values: ['orders:read'] }
  ])('T003 EXPECTED_RED: fails closed for missing or wrong provider_trusted material', async (trustedPermissionMaterial) => {
    const fixture = createFixture({
      policy: policy({ mode: 'provider_trusted', permissionSourceInstanceId: null, normalizerType: 'idx-menu-detail/v1', projectionContractVersion: 'managed-permissions/v1', projectionContract: Object.freeze({ scopeSchema: 'managed-normalized-scopes/v1' }) })
    });
    const request = input(fixture.policy);
    const admittedIdentity = createVerifiedExternalIdentity({ subject: 'actor-a', anchors: [{ kind: 'idx_entry', value: 'entry-a' }], ...(trustedPermissionMaterial === undefined ? {} : { trustedPermissionMaterial: trustedPermissionMaterial as TrustedPermissionMaterial }) });
    await expect(pipeline(fixture).resolve({ ...request, admittedIdentity })).rejects.toBeInstanceOf(ManagedExchangeIdentityDeniedError);
    expect(fixture.adapter.execute).not.toHaveBeenCalled();
  });

  it('returns frozen empty scopes for allow_empty without a configured source', async () => {
    const fixture = createFixture({ policy: policy({ mode: 'allow_empty', permissionSourceInstanceId: null, normalizerType: null, projectionContractVersion: null, projectionContract: null }) });
    const scopes = await pipeline(fixture).resolve(input(fixture.policy));
    expect(scopes).toEqual([]);
    expect(Object.isFrozen(scopes)).toBe(true);
    expect(fixture.adapter.execute).not.toHaveBeenCalled();
    expect(fixture.normalizer!.normalize).not.toHaveBeenCalled();
    expect(fixture.projector.project).not.toHaveBeenCalled();
  });

  it('does not downgrade a configured-but-missing allow_empty source to empty scopes', async () => {
    const fixture = createFixture({ source: null });
    await expect(pipeline(fixture).resolve(input(fixture.policy))).rejects.toBeInstanceOf(ManagedExchangeInfrastructureError);
    expect(fixture.adapter.execute).not.toHaveBeenCalled();
    expect(fixture.normalizer!.normalize).not.toHaveBeenCalled();
    expect(fixture.projector.project).not.toHaveBeenCalled();
  });

  it('returns frozen authoritative empty scopes after every configured dependency succeeds', async () => {
    const fixture = createFixture({ material: material(), normalized: [], scopes: [] });
    const scopes = await pipeline(fixture).resolve(input(fixture.policy));
    expect(scopes).toEqual([]);
    expect(Object.isFrozen(scopes)).toBe(true);
    expect(fixture.adapter.execute).toHaveBeenCalledTimes(1);
    expect(fixture.normalizer!.normalize).toHaveBeenCalledTimes(1);
    expect(fixture.projector.project).toHaveBeenCalledTimes(1);
  });

  it('does not downgrade an unavailable configured allow_empty adapter to empty scopes', async () => {
    const fixture = createFixture({ adapter: { execute: jest.fn(async () => { throw new ManagedExchangeInfrastructureError(); }) } });
    await expect(pipeline(fixture).resolve(input(fixture.policy))).rejects.toBeInstanceOf(ManagedExchangeInfrastructureError);
    expect(fixture.adapter.execute).toHaveBeenCalledTimes(1);
    expect(fixture.normalizer!.normalize).not.toHaveBeenCalled();
    expect(fixture.projector.project).not.toHaveBeenCalled();
  });

  it('classifies configured adapter outage and timeout-like failures as infrastructure', async () => {
    for (const error of [new ManagedExchangeInfrastructureError(), new Error('timeout')]) {
      const fixture = createFixture({ adapter: { execute: jest.fn(async () => { throw error; }) } });
      await expect(pipeline(fixture).resolve(input(fixture.policy))).rejects.toBeInstanceOf(ManagedExchangeInfrastructureError);
      expect(fixture.adapter.execute).toHaveBeenCalledTimes(1);
      expect(fixture.normalizer!.normalize).not.toHaveBeenCalled();
      expect(fixture.projector.project).not.toHaveBeenCalled();
    }
  });

  it.each<[string, unknown]>([
    ['null', null],
    ['array', []],
    ['empty object', {}],
    ['missing kind', { values: ['orders:read'] }],
    ['blank kind', { kind: '   ', values: ['orders:read'] }],
    ['extra field', { kind: 'material', values: ['orders:read'], extra: true }],
    ['blank reference', { kind: 'material', reference: '   ' }],
    ['control-character reference', { kind: 'material', reference: 'reference\u0000' }],
    ['non-array values', { kind: 'material', values: 'orders:read' }],
    ['blank value', { kind: 'material', values: ['   '] }],
    ['control-character value', { kind: 'material', values: ['orders\u0000read'] }]
  ])('classifies malformed configured source output (%s) as infrastructure before normalization', async (_caseName, invalidMaterial) => {
    const fixture = createFixture({ material: invalidMaterial });
    await expect(pipeline(fixture).resolve(input(fixture.policy))).rejects.toBeInstanceOf(ManagedExchangeInfrastructureError);
    expect(fixture.adapter.execute).toHaveBeenCalledTimes(1);
    expect(fixture.normalizer!.normalize).not.toHaveBeenCalled();
    expect(fixture.projector.project).not.toHaveBeenCalled();
  });

  it('does not downgrade an unavailable configured allow_empty normalizer to empty scopes', async () => {
    const fixture = createFixture({ normalizer: undefined });
    await expect(pipeline(fixture).resolve(input(fixture.policy))).rejects.toBeInstanceOf(ManagedExchangeInfrastructureError);
    expect(fixture.adapter.execute).toHaveBeenCalledTimes(1);
    expect(fixture.projector.project).not.toHaveBeenCalled();
  });

  it('requires a configured source for required mode', async () => {
    const fixture = createFixture({ policy: policy({ mode: 'required', permissionSourceInstanceId: null, normalizerType: null, projectionContractVersion: null, projectionContract: null }) });
    await expect(pipeline(fixture).resolve(input(fixture.policy))).rejects.toBeInstanceOf(ManagedExchangeInfrastructureError);
    expect(fixture.adapter.execute).not.toHaveBeenCalled();
  });

  it('requires the configured source to be enabled and active for required mode', async () => {
    const fixture = createFixture({ source: null, policy: policy({ mode: 'required' }) });
    await expect(pipeline(fixture).resolve(input(fixture.policy))).rejects.toBeInstanceOf(ManagedExchangeInfrastructureError);
    expect(fixture.adapter.execute).not.toHaveBeenCalled();
  });

  it('requires an available adapter for required mode', async () => {
    const fixture = createFixture({ policy: policy({ mode: 'required' }), adapter: { execute: jest.fn(async () => { throw new ManagedExchangeInfrastructureError(); }) } });
    await expect(pipeline(fixture).resolve(input(fixture.policy))).rejects.toBeInstanceOf(ManagedExchangeInfrastructureError);
    expect(fixture.adapter.execute).toHaveBeenCalledTimes(1);
  });

  it('classifies required configured source outage as infrastructure', async () => {
    const fixture = createFixture({ policy: policy({ mode: 'required' }), adapter: { execute: jest.fn(async () => { throw new ManagedExchangeInfrastructureError(); }) } });
    await expect(pipeline(fixture).resolve(input(fixture.policy))).rejects.toBeInstanceOf(ManagedExchangeInfrastructureError);
    expect(fixture.normalizer!.normalize).not.toHaveBeenCalled();
  });

  it('requires an available normalizer for required mode', async () => {
    const fixture = createFixture({ policy: policy({ mode: 'required' }), normalizer: undefined });
    await expect(pipeline(fixture).resolve(input(fixture.policy))).rejects.toBeInstanceOf(ManagedExchangeInfrastructureError);
    expect(fixture.adapter.execute).toHaveBeenCalledTimes(1);
  });

  it('preserves normalizer semantic denial without invoking the projector', async () => {
    const fixture = createFixture({ normalizer: { normalize: jest.fn(() => { throw new ManagedExchangeIdentityDeniedError(); }) } });
    await expect(pipeline(fixture).resolve(input(fixture.policy))).rejects.toBeInstanceOf(ManagedExchangeIdentityDeniedError);
    expect(fixture.adapter.execute).toHaveBeenCalledTimes(1);
    expect(fixture.normalizer!.normalize).toHaveBeenCalledTimes(1);
    expect(fixture.projector.project).not.toHaveBeenCalled();
  });

  it('preserves projector semantic denial after successful normalization', async () => {
    const fixture = createFixture({ projector: { project: jest.fn(() => { throw new ManagedExchangeIdentityDeniedError(); }) } });
    await expect(pipeline(fixture).resolve(input(fixture.policy))).rejects.toBeInstanceOf(ManagedExchangeIdentityDeniedError);
    expect(fixture.adapter.execute).toHaveBeenCalledTimes(1);
    expect(fixture.normalizer!.normalize).toHaveBeenCalledTimes(1);
    expect(fixture.projector.project).toHaveBeenCalledTimes(1);
  });

  it('returns frozen required scopes through exactly one source, normalizer, and projector path', async () => {
    const fixture = createFixture({ policy: policy({ mode: 'required' }), scopes: ['orders:read'] });
    const scopes = await pipeline(fixture).resolve(input(fixture.policy));
    expect(scopes).toEqual(['orders:read']);
    expect(Object.isFrozen(scopes)).toBe(true);
    expect(fixture.adapter.execute).toHaveBeenCalledTimes(1);
    expect(fixture.normalizer!.normalize).toHaveBeenCalledTimes(1);
    expect(fixture.projector.project).toHaveBeenCalledTimes(1);
  });

  it('rejects policy/config mismatches before every dependency and retains the service authority boundary', async () => {
    const fixture = createFixture();
    await expect(pipeline(fixture).resolve(input(fixture.policy, { integrationConfigId: 'config-b' }))).rejects.toBeInstanceOf(ManagedExchangeInfrastructureError);
    expect(fixture.permissionSources.findEnabledActiveById).not.toHaveBeenCalled();
    expect(fixture.adapter.execute).not.toHaveBeenCalled();
    expect(fixture.normalizer!.normalize).not.toHaveBeenCalled();
    expect(fixture.projector.project).not.toHaveBeenCalled();

    const source = readFileSync(servicePath, 'utf8');
    expect(source).not.toMatch(/Customer|CustomerScope|IntegrationBinding|PageContext|nativeCredential|Authorization|VerifyNativeCredentialInput|DelegatedHttpTransport|IDX|UUID|SCM|UserType|IsAdmin|ManagedTokenIssuer|GatewaySigningKey|retry|fallback|register\(|unregister\(|eval\(|new Function|JSONPath/i);
  });

  it('rejects a configured policy without a normalizer type', async () => {
    const fixture = createFixture({ policy: policy({ normalizerType: null }) });
    await expect(pipeline(fixture).resolve(input(fixture.policy))).rejects.toBeInstanceOf(ManagedExchangeInfrastructureError);
    expect(fixture.adapter.execute).not.toHaveBeenCalled();
    expect(fixture.projector.project).not.toHaveBeenCalled();
  });

  it('rejects a configured policy without a projection version or contract', async () => {
    for (const incomplete of [policy({ projectionContractVersion: null }), policy({ projectionContract: null })]) {
      const fixture = createFixture({ policy: incomplete });
      await expect(pipeline(fixture).resolve(input(fixture.policy))).rejects.toBeInstanceOf(ManagedExchangeInfrastructureError);
      expect(fixture.adapter.execute).not.toHaveBeenCalled();
      expect(fixture.projector.project).not.toHaveBeenCalled();
    }
  });

  it('maps unexpected normalizer errors to infrastructure', async () => {
    const fixture = createFixture({ normalizer: { normalize: jest.fn(() => { throw new Error('normalizer unavailable'); }) } });
    await expect(pipeline(fixture).resolve(input(fixture.policy))).rejects.toBeInstanceOf(ManagedExchangeInfrastructureError);
    expect(fixture.adapter.execute).toHaveBeenCalledTimes(1);
    expect(fixture.normalizer!.normalize).toHaveBeenCalledTimes(1);
    expect(fixture.projector.project).not.toHaveBeenCalled();
  });

  it('maps unexpected projector errors to infrastructure', async () => {
    const fixture = createFixture({ projector: { project: jest.fn(() => { throw new Error('projector unavailable'); }) } });
    await expect(pipeline(fixture).resolve(input(fixture.policy))).rejects.toBeInstanceOf(ManagedExchangeInfrastructureError);
    expect(fixture.adapter.execute).toHaveBeenCalledTimes(1);
    expect(fixture.normalizer!.normalize).toHaveBeenCalledTimes(1);
    expect(fixture.projector.project).toHaveBeenCalledTimes(1);
  });

  it('copies mutable projector output and forwards only trusted source input', async () => {
    let captured: ResolvePermissionInput | undefined;
    const fixture = createFixture({
      source: { ...sourceRecord(), endpointUri: 'https://not-forwarded.example', contractConfig: { ignored: true }, providerInstanceId: 'provider-a' } as Source,
      adapter: { execute: jest.fn(async (value: ResolvePermissionInput) => { captured = value; return material(); }) },
      scopes: ['orders:read']
    });
    const scopes = await pipeline(fixture).resolve(input(fixture.policy));

    expect(scopes).toEqual(['orders:read']);
    expect(Object.isFrozen(scopes)).toBe(true);
    expect(scopes).not.toBe(fixture.projector.project.mock.results[0]?.value);
    expect(fixture.adapter.execute).toHaveBeenCalledTimes(1);
    expect(fixture.normalizer!.normalize).toHaveBeenCalledTimes(1);
    expect(fixture.projector.project).toHaveBeenCalledTimes(1);
    expect(captured).toBeDefined();
    if (!captured) throw new Error('Permission source adapter did not receive trusted input.');
    expect(Object.keys(captured).sort()).toEqual(['admittedIdentity', 'permissionSourcePolicy', 'requestId', 'serverOwnedIntegrationContext', 'serviceCredentialReference', 'trustedPermissionMaterial', 'trustedPermissionReference']);
    expect(Object.keys(captured.permissionSourcePolicy).sort()).toEqual(['adapterContractReference', 'id', 'sourceType']);
    expect(captured).not.toHaveProperty('endpointUri');
    expect(captured).not.toHaveProperty('contractConfig');
    expect(captured).not.toHaveProperty('providerInstanceId');
  });
});

function pipeline(dependencies: Fixture): FuturePipeline {
  const target = require('../../src/managed-identity-exchange/permissions/managed-permission.service') as { ManagedPermissionService: new (dependencies: Dependencies) => FuturePipeline };
  return new target.ManagedPermissionService(dependencies);
}

type Fixture = Dependencies & Readonly<{
  policy: Policy;
  source: Source | null;
  adapter: { execute: jest.Mock };
  normalizer: { normalize: jest.Mock } | undefined;
  projector: { project: jest.Mock };
}>;

function createFixture(overrides: Partial<Readonly<{ policy: Policy; source: Source | null; adapter: { execute: jest.Mock }; normalizer: { normalize: jest.Mock } | undefined; projector: { project: jest.Mock }; material: unknown; normalized: readonly NormalizedPermission[]; scopes: readonly string[] }>> = {}): Fixture {
  const currentMaterial = Object.prototype.hasOwnProperty.call(overrides, 'material') ? overrides.material : material();
  const currentNormalized = overrides.normalized ?? Object.freeze([{ subject: 'orders', action: 'read' }]);
  const currentScopes = overrides.scopes ?? Object.freeze(['orders:read']);
  const adapter = overrides.adapter ?? { execute: jest.fn(async () => currentMaterial) };
  const normalizer = overrides.normalizer === undefined && Object.prototype.hasOwnProperty.call(overrides, 'normalizer') ? undefined : overrides.normalizer ?? { normalize: jest.fn(() => currentNormalized) };
  const projector = overrides.projector ?? { project: jest.fn(() => Object.freeze([...currentScopes])) };
  const source = overrides.source === undefined ? sourceRecord() : overrides.source;
  const currentPolicy = overrides.policy ?? policy();
  return {
    policy: currentPolicy,
    source,
    adapter,
    normalizer,
    projector,
    permissionSources: { findEnabledActiveById: jest.fn(async () => source) },
    permissionAdapters: adapter,
    permissionNormalizers: { resolve: jest.fn(() => normalizer) }
  };
}

function policy(overrides: Partial<Policy> = {}): Policy {
  return { integrationConfigId: 'config-a', mode: 'allow_empty', permissionSourceInstanceId: 'source-a', normalizerType: 'synthetic-normalizer/v1', projectionContractVersion: 'managed-permissions/v1', projectionContract: Object.freeze({ scopeSchema: 'managed-normalized-scopes/v1' }), ...overrides };
}

function sourceRecord(): Source {
  return { id: 'source-a', sourceType: 'synthetic', serviceCredentialReference: 'deployment-reference', adapterContractReference: 'synthetic/v1' };
}

function material(): TrustedPermissionMaterial {
  return Object.freeze({ kind: 'managed-permission-material/v1', values: Object.freeze(['orders:read']) });
}

function input(policyValue: Policy, overrides: Readonly<{ integrationConfigId?: string }> = {}) {
  return Object.freeze({
    admittedIdentity: createVerifiedExternalIdentity({
      subject: 'actor-a', anchors: [{ kind: 'organization', value: 'organization-a' }],
      trustedPermissionReference: 'trusted-reference-a',
      trustedPermissionMaterial: { kind: 'prior-trusted-material', values: ['scope-a'] }
    }),
    integrationConfigId: overrides.integrationConfigId ?? 'config-a', serverOwnedIntegrationContext: Object.freeze({ integrationId: 'integration-a', hostApp: 'admin' }), requestId: 'request-a', policy: policyValue
  });
}
