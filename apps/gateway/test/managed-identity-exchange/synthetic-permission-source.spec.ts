import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  createVerifiedExternalIdentity,
  ManagedExchangeIdentityDeniedError,
  ManagedExchangeInfrastructureError,
  type ResolvePermissionInput
} from '../../src/managed-identity-exchange/domain/managed-exchange.domain';
import { ManagedPermissionScopeProjector } from '../../src/managed-identity-exchange/permissions/managed-permission-scope.projector';
import { ManagedPermissionService, type ResolveManagedPermissionInput } from '../../src/managed-identity-exchange/permissions/managed-permission.service';
import { PermissionNormalizerRegistry } from '../../src/managed-identity-exchange/permissions/permission-normalizer.registry';
import { PermissionSourceAdapterRegistry } from '../../src/managed-identity-exchange/permissions/permission-source-adapter.registry';
import { SyntheticV1PermissionNormalizer } from '../../src/managed-identity-exchange/permissions/synthetic-v1-permission.normalizer';
import { createSyntheticPermissionSourceFixture, type SyntheticPermissionSourceScenario } from './fixtures/synthetic-permission-source.fixture';

const fixturePath = resolve(__dirname, './fixtures/synthetic-permission-source.fixture.ts');
const modulePath = resolve(__dirname, '../../src/managed-identity-exchange/managed-identity-exchange.module.ts');
const diagnostic = 'DO_NOT_LEAK_SYNTHETIC_PERMISSION_SOURCE_DIAGNOSTIC';
const nativeCredential = 'DO_NOT_FORWARD_NATIVE_CREDENTIAL';

describe('Synthetic permission-source fixture (T040)', () => {
  it('runs trusted material through the production registry, normalizer, projector, and pipeline', async () => {
    const fixture = pipelineFixture('trusted');
    const scopes = await fixture.service.resolve(fixture.input);

    expect(scopes).toEqual(['orders:read', 'orders:update']);
    expect(Object.isFrozen(scopes)).toBe(true);
    expect(fixture.resolve).toHaveBeenCalledTimes(1);
    expect(fixture.normalize).toHaveBeenCalledTimes(1);
    expect(fixture.project).toHaveBeenCalledTimes(1);
    const material = fixture.normalize.mock.calls[0][0];
    expect(material).toEqual({ kind: 'managed-permission-material/v1', reference: 'synthetic-permission-reference', values: ['orders:read', 'orders:update', 'orders:read'] });
    expect(Object.isFrozen(material)).toBe(true);
    expect(Object.isFrozen(material.values)).toBe(true);
  });

  it('forwards only the exact trusted permission-source boundary', async () => {
    const fixture = pipelineFixture('trusted');
    await fixture.service.resolve(fixture.input);
    const captured = fixture.fixture.adapter.input;
    expect(captured).toBeDefined();
    if (!captured) throw new Error('Synthetic source did not receive an input.');
    expect(Object.keys(captured).sort()).toEqual([
      'admittedIdentity', 'permissionSourcePolicy', 'requestId', 'serverOwnedIntegrationContext',
      'serviceCredentialReference', 'trustedPermissionMaterial', 'trustedPermissionReference'
    ]);
    expect(captured.admittedIdentity).toBe(fixture.input.admittedIdentity);
    expect(Object.keys(captured.permissionSourcePolicy).sort()).toEqual(['adapterContractReference', 'id', 'sourceType']);
    expect(Object.keys(captured.serverOwnedIntegrationContext).sort()).toEqual(['hostApp', 'integrationId']);
    expect(captured.serverOwnedIntegrationContext).toEqual({ integrationId: 'integration-a', hostApp: 'admin' });
    expect(captured.serviceCredentialReference).toBe('synthetic-service-reference');
    expect(Object.isFrozen(captured)).toBe(true);
    expect(Object.isFrozen(captured.permissionSourcePolicy)).toBe(true);
    expect(Object.isFrozen(captured.serverOwnedIntegrationContext)).toBe(true);
    for (const forbidden of ['nativeCredential', 'Authorization', 'authorization', 'rawJwt', 'callbackData', 'callbackToken', 'cookie', 'PageContext', 'pageContext', 'headers', 'browserRequest', 'customerId', 'integrationSelector', 'endpointUri', 'providerInstanceId', 'providerType', 'contractConfig', nativeCredential]) {
      expect(JSON.stringify(captured)).not.toContain(forbidden);
    }
  });

  it('distinguishes configured authoritative empty material from unconfigured allow_empty', async () => {
    const configured = pipelineFixture('authoritative-empty');
    const scopes = await configured.service.resolve(configured.input);
    expect(scopes).toEqual([]);
    expect(Object.isFrozen(scopes)).toBe(true);
    expect(configured.resolve).toHaveBeenCalledTimes(1);
    expect(configured.normalize).toHaveBeenCalledTimes(1);
    expect(configured.project).toHaveBeenCalledTimes(1);

    const unconfigured = pipelineFixture('trusted', 'allow_empty', true);
    const noSourceScopes = await unconfigured.service.resolve(unconfigured.input);
    expect(noSourceScopes).toEqual([]);
    expect(Object.isFrozen(noSourceScopes)).toBe(true);
    expect(unconfigured.resolve).not.toHaveBeenCalled();
    expect(unconfigured.normalize).not.toHaveBeenCalled();
    expect(unconfigured.project).not.toHaveBeenCalled();
  });

  it('preserves normalization semantic denial after one source call', async () => {
    const fixture = pipelineFixture('semantic-denial');
    await expect(fixture.service.resolve(fixture.input)).rejects.toBeInstanceOf(ManagedExchangeIdentityDeniedError);
    expect(fixture.resolve).toHaveBeenCalledTimes(1);
    expect(fixture.normalize).toHaveBeenCalledTimes(1);
    expect(fixture.project).not.toHaveBeenCalled();
  });

  it('rejects structurally malformed source material as infrastructure before normalization', async () => {
    const fixture = pipelineFixture('malformed');
    await expect(fixture.service.resolve(fixture.input)).rejects.toBeInstanceOf(ManagedExchangeInfrastructureError);
    expect(fixture.resolve).toHaveBeenCalledTimes(1);
    expect(fixture.normalize).not.toHaveBeenCalled();
    expect(fixture.project).not.toHaveBeenCalled();
  });

  it.each(['allow_empty', 'required'] as const)('does not downgrade configured %s source outage to scopes or retry', async (mode) => {
    const fixture = pipelineFixture('outage', mode);
    const error = await fixture.service.resolve(fixture.input).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ManagedExchangeInfrastructureError);
    expect(`${String(error)} ${JSON.stringify(error)}`).not.toContain(diagnostic);
    expect(fixture.resolve).toHaveBeenCalledTimes(1);
    expect(fixture.normalize).not.toHaveBeenCalled();
    expect(fixture.project).not.toHaveBeenCalled();
  });

  it.each(['allow_empty', 'required'] as const)('accepts successful configured %s source material without requiring nonempty scopes', async (mode) => {
    const fixture = pipelineFixture('authoritative-empty', mode);
    const scopes = await fixture.service.resolve(fixture.input);
    expect(scopes).toEqual([]);
    expect(Object.isFrozen(scopes)).toBe(true);
    expect(fixture.resolve).toHaveBeenCalledTimes(1);
    expect(fixture.normalize).toHaveBeenCalledTimes(1);
    expect(fixture.project).toHaveBeenCalledTimes(1);
  });

  it('keeps fixture source test-only, authority-free, and unregistered in production composition', () => {
    const source = readFileSync(fixturePath, 'utf8');
    const module = readFileSync(modulePath, 'utf8');
    expect(source).not.toMatch(/Customer|CustomerScope|IntegrationBinding|PageContext|nativeCredential|Authorization|rawJwt|callback|IDX|SCM|UUID|UserType|IsAdmin|ManagedTokenIssuer|GatewaySigningKey|roles|apiKey|password|DelegatedHttpTransport|DelegatedHttpV1Adapter|VerifyNativeCredentialInput/i);
    expect(module).not.toContain('SyntheticPermissionSourceFixture');
    expect(module).toContain('new PermissionSourceAdapterRegistry([])');
  });
});

function pipelineFixture(scenario: SyntheticPermissionSourceScenario, mode: 'allow_empty' | 'required' = 'allow_empty', noSource = false) {
  const fixture = createSyntheticPermissionSourceFixture(scenario);
  const normalizer = new SyntheticV1PermissionNormalizer();
  const projector = new ManagedPermissionScopeProjector();
  const resolve = jest.spyOn(fixture.adapter, 'resolve');
  const normalize = jest.spyOn(normalizer, 'normalize');
  const project = jest.spyOn(projector, 'project');
  const source = noSource ? null : fixture.source;
  const policy = Object.freeze({
    integrationConfigId: 'config-a', mode,
    permissionSourceInstanceId: noSource ? null : fixture.source.id,
    normalizerType: noSource ? null : 'synthetic-normalizer/v1',
    projectionContractVersion: noSource ? null : 'managed-permissions/v1',
    projectionContract: noSource ? null : Object.freeze({ scopeSchema: 'managed-normalized-scopes/v1' })
  });
  const service = new ManagedPermissionService({
    permissionSources: { findEnabledActiveById: jest.fn(async () => source) },
    permissionAdapters: new PermissionSourceAdapterRegistry([fixture.adapter]),
    permissionNormalizers: new PermissionNormalizerRegistry([normalizer]),
    projector
  });
  return Object.freeze({ fixture, service, resolve, normalize, project, input: permissionInput(policy) });
}

function permissionInput(policy: Readonly<Record<string, unknown>>): ResolveManagedPermissionInput {
  return Object.freeze({
    admittedIdentity: createVerifiedExternalIdentity({
      subject: 'synthetic-subject', organization: 'synthetic-organization',
      anchors: [{ kind: 'organization', value: 'synthetic-organization' }],
      trustedPermissionReference: 'provider-trusted-permission-reference',
      trustedPermissionMaterial: { kind: 'provider-trusted-material', values: ['provider:trusted'] }
    }),
    integrationConfigId: 'config-a',
    serverOwnedIntegrationContext: Object.freeze({ integrationId: 'integration-a', hostApp: 'admin' }),
    requestId: 'request-a', policy: policy as never
  });
}
