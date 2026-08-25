import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  createVerifiedExternalIdentity,
  ManagedExchangeIdentityDeniedError,
  ManagedExchangeInfrastructureError,
  type PermissionSourceAdapter,
  type ResolvePermissionInput,
  type TrustedPermissionMaterial
} from '../../src/managed-identity-exchange/domain/managed-exchange.domain';
import type { ManagedPermissionPolicyRecord, ManagedPermissionSourceInstanceRecord } from '../../src/managed-identity-exchange/persistence/managed-exchange.repository';
import { ManagedPermissionScopeProjector } from '../../src/managed-identity-exchange/permissions/managed-permission-scope.projector';
import { ManagedPermissionService, type ResolveManagedPermissionInput } from '../../src/managed-identity-exchange/permissions/managed-permission.service';
import { PermissionNormalizerRegistry } from '../../src/managed-identity-exchange/permissions/permission-normalizer.registry';
import { PermissionSourceAdapterRegistry } from '../../src/managed-identity-exchange/permissions/permission-source-adapter.registry';
import { SyntheticIdxPermissionNormalizerFixture } from './fixtures/synthetic-idx-permission-normalizer.fixture';

const permissionDirectory = resolve(__dirname, '../../src/managed-identity-exchange/permissions');
const fixturePath = resolve(__dirname, './fixtures/synthetic-idx-permission-normalizer.fixture.ts');
const projectionContract = Object.freeze({ scopeSchema: 'managed-normalized-scopes/v1' });

describe('Synthetic IDX permission normalizer fixture (T028)', () => {
  it('T003 EXPECTED_RED: retains only immutable semantic IDX MenuDetail material', () => {
    const identity = createVerifiedExternalIdentity({
      subject: 'actor-a', anchors: [{ kind: 'idx_entry', value: 'entry-a' }],
      trustedPermissionMaterial: { kind: 'idx-menu-detail/v1', menus: [{ menuId: 'ORDERS', actions: ['read', 'update'] }] } as unknown as TrustedPermissionMaterial
    });
    const material = identity.trustedPermissionMaterial as unknown as { kind: string; menus: readonly { menuId: string; actions: readonly string[] }[] };
    expect(material).toEqual({ kind: 'idx-menu-detail/v1', menus: [{ menuId: 'ORDERS', actions: ['read', 'update'] }] });
    expect(Object.isFrozen(material)).toBe(true);
    expect(Object.isFrozen(material.menus)).toBe(true);
  });

  it.each([
    { UUID: 'idx-uuid' }, { nativeAccessToken: 'token' }, { authorization: 'Bearer token' }, { claims: { sub: 'actor-a' } },
    { response: { status: 200 } }, { customerId: 'customer-a' }, { integrationId: 'integration-a' }, { metadata: { arbitrary: true } }
  ])('T003 EXPECTED_RED: rejects forbidden IDX material authority %o', (forbidden) => {
    expect(() => createVerifiedExternalIdentity({
      subject: 'actor-a', anchors: [{ kind: 'idx_entry', value: 'entry-a' }],
      trustedPermissionMaterial: { kind: 'idx-menu-detail/v1', menus: [], ...forbidden } as unknown as TrustedPermissionMaterial
    })).toThrow();
  });

  it('registers the exact test-only normalizer without executing it during lookup', () => {
    const normalizer = new SyntheticIdxPermissionNormalizerFixture();
    const normalize = jest.spyOn(normalizer, 'normalize');
    const registry = new PermissionNormalizerRegistry([normalizer]);

    expect(registry.resolve('synthetic-idx-permission/v1')).toBe(normalizer);
    expect(registry.resolve('synthetic-idx-permission/v1')).toBe(normalizer);
    expect(registry.resolve('unknown')).toBeUndefined();
    expect(normalize).not.toHaveBeenCalled();
  });

  it('projects fixed synthetic permissions through the full trusted pipeline', async () => {
    const fixture = createFixture(material(['fixture-orders-read', 'fixture-orders-update', 'fixture-orders-read']));
    const scopes = await fixture.service.resolve(input());

    expect(scopes).toEqual(['orders:read', 'orders:update']);
    expect(Object.isFrozen(scopes)).toBe(true);
    expect(fixture.sourceLookup).toHaveBeenCalledTimes(1);
    expect(fixture.adapter.resolve).toHaveBeenCalledTimes(1);
    expect(fixture.normalize).toHaveBeenCalledTimes(1);
    expect(fixture.project).toHaveBeenCalledTimes(1);
    expect(fixture.captured).toBeDefined();
    if (!fixture.captured) throw new Error('Fixture adapter did not receive trusted input.');
    expect(Object.keys(fixture.captured).sort()).toEqual([
      'admittedIdentity', 'permissionSourcePolicy', 'requestId', 'serverOwnedIntegrationContext',
      'serviceCredentialReference', 'trustedPermissionMaterial', 'trustedPermissionReference'
    ]);
    expect(Object.keys(fixture.captured.permissionSourcePolicy).sort()).toEqual(['adapterContractReference', 'id', 'sourceType']);
    for (const forbidden of ['nativeCredential', 'Authorization', 'rawJwt', 'callbackData', 'PageContext', 'customerId', 'endpointUri', 'contractConfig', 'providerInstanceId']) {
      expect(fixture.captured).not.toHaveProperty(forbidden);
    }
    expect(scopes).not.toHaveProperty('roles');
  });

  it('keeps successful configured empty material authoritative and immutable', async () => {
    const fixture = createFixture(material());
    const scopes = await fixture.service.resolve(input());

    expect(scopes).toEqual([]);
    expect(Object.isFrozen(scopes)).toBe(true);
    expect(fixture.adapter.resolve).toHaveBeenCalledTimes(1);
    expect(fixture.normalize).toHaveBeenCalledTimes(1);
    expect(fixture.project).toHaveBeenCalledTimes(1);
  });

  it('preserves fixture semantic denial rather than producing scopes', async () => {
    const fixture = createFixture(material(['fixture-unknown']));
    await expect(fixture.service.resolve(input())).rejects.toBeInstanceOf(ManagedExchangeIdentityDeniedError);
    expect(fixture.adapter.resolve).toHaveBeenCalledTimes(1);
    expect(fixture.normalize).toHaveBeenCalledTimes(1);
    expect(fixture.project).not.toHaveBeenCalled();
  });

  it('does not downgrade a configured fixture-adapter outage in allow_empty mode', async () => {
    const fixture = createFixture(material(['fixture-orders-read']), new Error('fixture unavailable'));
    await expect(fixture.service.resolve(input())).rejects.toBeInstanceOf(ManagedExchangeInfrastructureError);
    expect(fixture.adapter.resolve).toHaveBeenCalledTimes(1);
    expect(fixture.normalize).not.toHaveBeenCalled();
    expect(fixture.project).not.toHaveBeenCalled();
  });

  it('keeps the fixture synthetic and production permission code authority-free', () => {
    const fixture = readFileSync(fixturePath, 'utf8');
    expect(fixture).not.toMatch(/UUID|SCM|menu|Customer|UserType|IsAdmin|nativeCredential|Authorization|PageContext|endpoint|secret|dynamic mapping|roles/i);

    const production = permissionSources(permissionDirectory).map((path) => readFileSync(path, 'utf8')).join('\n');
    expect(production).not.toMatch(/IDX|SCM|UUID|UserType|IsAdmin|Customer|CustomerScope|IntegrationBinding|nativeCredential|Authorization|PageContext|ManagedTokenIssuer|GatewaySigningKey/i);
  });
});

function createFixture(sourceMaterial: TrustedPermissionMaterial, failure?: Error) {
  let captured: ResolvePermissionInput | undefined;
  const adapter: PermissionSourceAdapter & { resolve: jest.Mock } = {
    sourceType: 'synthetic-idx-fixture',
    resolve: jest.fn(async (value: ResolvePermissionInput) => {
      captured = value;
      if (failure) throw failure;
      return sourceMaterial;
    })
  };
  const normalizer = new SyntheticIdxPermissionNormalizerFixture();
  const normalize = jest.spyOn(normalizer, 'normalize');
  const projector = new ManagedPermissionScopeProjector();
  const project = jest.spyOn(projector, 'project');
  const sourceLookup = jest.fn(async () => sourceRecord());
  const service = new ManagedPermissionService({
    permissionSources: { findEnabledActiveById: sourceLookup },
    permissionAdapters: new PermissionSourceAdapterRegistry([adapter]),
    permissionNormalizers: new PermissionNormalizerRegistry([normalizer]),
    projector
  });
  return {
    service, adapter, normalize, project, sourceLookup,
    get captured() { return captured; }
  };
}

function input(): ResolveManagedPermissionInput {
  return Object.freeze({
    admittedIdentity: createVerifiedExternalIdentity({
      subject: 'actor-a', anchors: [{ kind: 'organization', value: 'organization-a' }],
      trustedPermissionReference: 'trusted-reference-a',
      trustedPermissionMaterial: { kind: 'prior-trusted-material', values: ['scope-a'] }
    }),
    integrationConfigId: 'config-a',
    serverOwnedIntegrationContext: Object.freeze({ integrationId: 'integration-a', hostApp: 'admin' }),
    requestId: 'request-a',
    policy: policy()
  });
}

function policy(): Pick<ManagedPermissionPolicyRecord, 'integrationConfigId' | 'mode' | 'permissionSourceInstanceId' | 'normalizerType' | 'projectionContractVersion' | 'projectionContract'> {
  return {
    integrationConfigId: 'config-a', mode: 'allow_empty', permissionSourceInstanceId: 'source-a',
    normalizerType: 'synthetic-idx-permission/v1', projectionContractVersion: 'managed-permissions/v1', projectionContract
  };
}

function sourceRecord(): Pick<ManagedPermissionSourceInstanceRecord, 'id' | 'sourceType' | 'serviceCredentialReference' | 'adapterContractReference'> {
  return {
    id: 'source-a', sourceType: 'synthetic-idx-fixture', serviceCredentialReference: 'fixture-deployment-reference', adapterContractReference: 'fixture/v1'
  };
}

function material(values?: readonly string[]): TrustedPermissionMaterial {
  return Object.freeze({ kind: 'synthetic-idx-permission-material/v1', ...(values === undefined ? {} : { values: Object.freeze([...values]) }) });
}

function permissionSources(directory: string): readonly string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? permissionSources(path) : entry.isFile() && path.endsWith('.ts') ? [path] : [];
  });
}
