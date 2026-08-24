import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createVerifiedExternalIdentity, ManagedExchangeInfrastructureError, type PermissionSourceAdapter, type ResolvePermissionInput } from '../../src/managed-identity-exchange/domain/managed-exchange.domain';
import { ManagedExchangeActivationValidator } from '../../src/managed-identity-exchange/persistence/managed-exchange-activation.validator';
import { ManagedPermissionSourceInstanceRepository } from '../../src/managed-identity-exchange/persistence/managed-exchange.repository';
import { PermissionSourceAdapterRegistry } from '../../src/managed-identity-exchange/permissions/permission-source-adapter.registry';

const registryPath = resolve(__dirname, '../../src/managed-identity-exchange/permissions/permission-source-adapter.registry.ts');
const nativeCredentialSentinel = 'DO_NOT_LEAK_NATIVE_SECRET';

describe('Permission source repository and adapter registry (T022)', () => {
  it('returns only an enabled active source record', async () => {
    const { repository, findFirst } = repositoryWith({ id: 'source-active', enabled: true, lifecycle: 'active' });

    await expect(repository.findEnabledActiveById('source-active')).resolves.toMatchObject({ id: 'source-active' });
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'source-active', enabled: true, lifecycle: 'active' } }));
  });

  it.each([
    { id: 'source-disabled', enabled: false, lifecycle: 'active' },
    { id: 'source-replaced', enabled: false, lifecycle: 'replaced' },
    { id: 'source-draft', enabled: false, lifecycle: 'draft' }
  ])('excludes non-active source records', async (record) => {
    const { repository } = repositoryWith(record);
    await expect(repository.findEnabledActiveById(record.id)).resolves.toBeNull();
  });

  it('returns null when the source is missing', async () => {
    const { repository } = repositoryWith();
    await expect(repository.findEnabledActiveById('source-missing')).resolves.toBeNull();
  });

  it('accepts the existing server-provisioned synthetic source contract', () => {
    expect(() => new ManagedExchangeActivationValidator().validatePermissionSource(permissionSourceContract())).not.toThrow();
  });

  it.each(['nativeCredential', 'browserAuthorization', 'authorization', 'rawJwt', 'callbackData', 'callbackToken'])('rejects a permission source contract that requests forbidden %s capability', (capability) => {
    expect(() => new ManagedExchangeActivationValidator().validatePermissionSource({
      ...permissionSourceContract(), contractConfig: { materialSchema: 'managed-permission-material/v1', [capability]: true }
    })).toThrow();
  });

  it('resolves the exact fixed adapter repeatedly without executing it', () => {
    const adapter = syntheticAdapter();
    const registry = new PermissionSourceAdapterRegistry([adapter]);

    expect(registry.resolve('synthetic')).toBe(adapter);
    expect(registry.resolve('synthetic')).toBe(adapter);
    expect(registry.resolve('unknown')).toBeUndefined();
    expect(registry.resolve('')).toBeUndefined();
    expect(adapter.resolve).not.toHaveBeenCalled();
  });

  it('rejects duplicate source types during fixed registry construction', () => {
    expect(() => new PermissionSourceAdapterRegistry([syntheticAdapter(), syntheticAdapter()])).toThrow();
  });

  it.each(['', '   ', '\t\n'])('rejects blank source types during fixed registry construction', (sourceType) => {
    expect(() => new PermissionSourceAdapterRegistry([syntheticAdapter(sourceType)])).toThrow();
  });

  it('accepts distinct source types and preserves exact lookup', () => {
    const first = syntheticAdapter('synthetic');
    const second = syntheticAdapter('other-source');
    const registry = new PermissionSourceAdapterRegistry([first, second]);

    expect(registry.resolve('synthetic')).toBe(first);
    expect(registry.resolve('other-source')).toBe(second);
    expect(first.resolve).not.toHaveBeenCalled();
    expect(second.resolve).not.toHaveBeenCalled();
  });

  it('has no runtime mutation or fallback API', () => {
    expect(Object.getOwnPropertyNames(PermissionSourceAdapterRegistry.prototype)).toEqual(expect.arrayContaining(['constructor', 'resolve']));
    expect(Object.getOwnPropertyNames(PermissionSourceAdapterRegistry.prototype)).not.toEqual(expect.arrayContaining(['register', 'unregister']));
  });

  it('keeps registry resolution free of source-specific and request authority', () => {
    const source = readFileSync(registryPath, 'utf8');
    expect(source).not.toMatch(/Customer|CustomerScope|IntegrationBinding|PageContext|IDX|ES512|decodeJwt|ManagedTokenIssuer|Canonicalization|integrationSelector|nativeCredential|Authorization|VerifyNativeCredentialInput|DelegatedHttpTransport|rawJwt|callback(Data|Token)?|register\(|unregister\(|fallback|sourceType\s*===\s*['"]/i);
  });

  it('forwards only valid trusted input to the selected adapter', async () => {
    let captured: ResolvePermissionInput | undefined;
    const adapter: PermissionSourceAdapter = {
      sourceType: 'synthetic',
      resolve: jest.fn(async (input) => {
        captured = input;
        return Object.freeze({ kind: 'synthetic' });
      })
    };
    const registry = new PermissionSourceAdapterRegistry([adapter]);
    const admittedIdentity = createVerifiedExternalIdentity({ subject: 'actor-a', anchors: [{ kind: 'organization', value: 'organization-a' }] });
    const input = trustedInput({ admittedIdentity });

    await registry.execute(input);
    expect(adapter.resolve).toHaveBeenCalledTimes(1);
    expect(captured).toBeDefined();
    if (!captured) throw new Error('Permission source adapter did not receive trusted input.');

    expect(Object.keys(captured).sort()).toEqual([
      'admittedIdentity', 'permissionSourcePolicy', 'requestId', 'serverOwnedIntegrationContext',
      'serviceCredentialReference', 'trustedPermissionMaterial', 'trustedPermissionReference'
    ]);
    expect(Object.keys(captured.permissionSourcePolicy).sort()).toEqual(['adapterContractReference', 'id', 'sourceType']);
    expect(captured.admittedIdentity).toBe(admittedIdentity);
    expect(captured.serviceCredentialReference).toBe('deployment-secret-reference');
    expect(Object.isFrozen(captured)).toBe(true);
    expect(Object.isFrozen(captured.permissionSourcePolicy)).toBe(true);
    expect(Object.isFrozen(captured.serverOwnedIntegrationContext)).toBe(true);
    expect(Object.isFrozen(captured.trustedPermissionMaterial)).toBe(true);
    expect(Object.isFrozen(captured.trustedPermissionMaterial?.values)).toBe(true);
    expect(JSON.stringify(captured)).not.toMatch(/nativeCredential|authorization|rawJwt|callbackData|callbackToken|cookie|pageContext|customerId|serviceCredentialValue|apiKey/i);
  });

  it('rejects hostile structural input before adapter execution', async () => {
    const adapter = syntheticAdapter();
    const registry = new PermissionSourceAdapterRegistry([adapter]);
    const hostile = {
      ...trustedInput(),
      nativeCredential: nativeCredentialSentinel,
      authorization: 'Bearer DO_NOT_FORWARD',
      rawJwt: 'RAW_JWT',
      callbackData: 'CALLBACK_SECRET',
      callbackToken: 'CALLBACK_TOKEN',
      cookie: 'COOKIE_SECRET',
      pageContext: 'PAGE_CONTEXT',
      customerId: 'customer-forged',
      serviceCredential: 'RAW_SERVICE_CREDENTIAL',
      serviceCredentialValue: 'RAW_SERVICE_CREDENTIAL_VALUE',
      secret: 'RAW_SECRET',
      apiKey: 'RAW_API_KEY'
    } as ResolvePermissionInput;

    let error: unknown;
    try { await registry.execute(hostile); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(ManagedExchangeInfrastructureError);
    expect(String(error)).not.toContain(nativeCredentialSentinel);
    expect(JSON.stringify(error)).not.toContain(nativeCredentialSentinel);
    expect(adapter.resolve).not.toHaveBeenCalled();
  });

  it('rejects an unknown source adapter without calling a registered adapter', async () => {
    const adapter = syntheticAdapter();
    const registry = new PermissionSourceAdapterRegistry([adapter]);

    await expect(registry.execute(trustedInput({ permissionSourcePolicy: { id: 'source-a', sourceType: 'unknown', adapterContractReference: 'synthetic/v1' } }))).rejects.toBeInstanceOf(ManagedExchangeInfrastructureError);
    expect(adapter.resolve).not.toHaveBeenCalled();
  });

  it.each([
    ['extra top-level field', { extra: true }],
    ['malformed policy', { permissionSourcePolicy: { id: 'source-a', sourceType: 'synthetic' } }],
    ['extra policy field', { permissionSourcePolicy: { id: 'source-a', sourceType: 'synthetic', adapterContractReference: 'synthetic/v1', extra: true } }],
    ['malformed context', { serverOwnedIntegrationContext: { integrationId: 'integration-a', hostApp: '   ' } }],
    ['extra context field', { serverOwnedIntegrationContext: { integrationId: 'integration-a', hostApp: 'admin', extra: true } }],
    ['blank service reference', { serviceCredentialReference: '   ' }],
    ['malformed trusted material', { trustedPermissionMaterial: { kind: 'material-a', values: ['scope-a', '  '] } }],
    ['extra trusted material field', { trustedPermissionMaterial: { kind: 'material-a', extra: true } }],
    ['extra identity field', { admittedIdentity: { subject: 'actor-a', anchors: [{ kind: 'organization', value: 'organization-a' }], extra: true } }],
    ['extra anchor field', { admittedIdentity: { subject: 'actor-a', anchors: [{ kind: 'organization', value: 'organization-a', extra: true }] } }],
    ['empty anchors', { admittedIdentity: { subject: 'actor-a', anchors: [] } }],
    ['malformed anchor', { admittedIdentity: { subject: 'actor-a', anchors: [{ kind: 'organization' }] } }],
    ['extra identity trusted material field', { admittedIdentity: { subject: 'actor-a', anchors: [{ kind: 'organization', value: 'organization-a' }], trustedPermissionMaterial: { kind: 'material-a', extra: true } } }]
  ])('rejects %s without calling an adapter', async (_name, override) => {
    const adapter = syntheticAdapter();
    const registry = new PermissionSourceAdapterRegistry([adapter]);

    await expect(registry.execute(trustedInput(override as Record<string, unknown>))).rejects.toBeInstanceOf(ManagedExchangeInfrastructureError);
    expect(adapter.resolve).not.toHaveBeenCalled();
  });

  it('rejects a sentinel-bearing extra identity field without leaking it', async () => {
    const adapter = syntheticAdapter();
    const registry = new PermissionSourceAdapterRegistry([adapter]);
    const hostile = trustedInput({ admittedIdentity: {
      subject: 'actor-a', anchors: [{ kind: 'organization', value: 'organization-a' }],
      extraField: nativeCredentialSentinel
    } });

    let error: unknown;
    try { await registry.execute(hostile); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(ManagedExchangeInfrastructureError);
    expect(String(error)).not.toContain(nativeCredentialSentinel);
    expect(JSON.stringify(error)).not.toContain(nativeCredentialSentinel);
    expect(adapter.resolve).not.toHaveBeenCalled();
  });

  it('remaps adapter failures without leaking adapter error data', async () => {
    const adapter: PermissionSourceAdapter = { sourceType: 'synthetic', resolve: jest.fn(async () => { throw new Error(nativeCredentialSentinel); }) };
    const registry = new PermissionSourceAdapterRegistry([adapter]);

    let error: unknown;
    try { await registry.execute(trustedInput()); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(ManagedExchangeInfrastructureError);
    expect(String(error)).not.toContain(nativeCredentialSentinel);
    expect(JSON.stringify(error)).not.toContain(nativeCredentialSentinel);
    expect(adapter.resolve).toHaveBeenCalledTimes(1);
  });
});

function repositoryWith(record?: Readonly<{ id: string; enabled: boolean; lifecycle: string }>) {
  const findFirst = jest.fn(async ({ where }: { where: Readonly<{ id: string; enabled: boolean; lifecycle: string }> }) => {
    if (!record || record.id !== where.id || !record.enabled || record.lifecycle !== 'active') return null;
    return record;
  });
  const repository = new ManagedPermissionSourceInstanceRepository({ managedPermissionSourceInstance: { findFirst } } as never);
  return { repository, findFirst };
}

function syntheticAdapter(sourceType = 'synthetic'): PermissionSourceAdapter & { resolve: jest.Mock } {
  return { sourceType, resolve: jest.fn() };
}

function permissionSourceContract(): Readonly<Record<string, unknown>> {
  return Object.freeze({
    sourceType: 'synthetic', adapterContractReference: 'synthetic/v1',
    contractConfig: Object.freeze({ materialSchema: 'managed-permission-material/v1' }),
    serviceCredentialReference: 'deployment-secret-reference'
  });
}

function trustedInput(overrides: Record<string, unknown> = {}): ResolvePermissionInput {
  return {
    admittedIdentity: createVerifiedExternalIdentity({ subject: 'actor-a', anchors: [{ kind: 'organization', value: 'organization-a' }] }),
    trustedPermissionReference: 'trusted-reference-a',
    trustedPermissionMaterial: Object.freeze({ kind: 'prior-trusted-material', values: Object.freeze(['scope-a']) }),
    serverOwnedIntegrationContext: Object.freeze({ integrationId: 'integration-a', hostApp: 'admin' }),
    serviceCredentialReference: 'deployment-secret-reference',
    permissionSourcePolicy: Object.freeze({ id: 'source-a', sourceType: 'synthetic', adapterContractReference: 'synthetic/v1' }),
    requestId: 'request-a',
    ...overrides
  } as ResolvePermissionInput;
}
