import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createVerifiedExternalIdentity, ManagedExchangeIdentityDeniedError, ManagedExchangeInfrastructureError } from '../../src/managed-identity-exchange/domain/managed-exchange.domain';
import { IntegrationAdmissionService } from '../../src/managed-identity-exchange/admission/integration-admission.service';
import { IdxDelegatedVerificationAdapter } from '../../src/managed-identity-exchange/providers/idx-delegated-verification.adapter';
import { IdxMenuDetailValidator } from '../../src/managed-identity-exchange/providers/idx-menu-detail.validator';

const identity = (anchors: readonly { kind: string; value: string }[], extras: Record<string, unknown> = {}) => createVerifiedExternalIdentity({ subject: 'same-subject', organization: 'org-a', anchors, ...extras });
const policy = (requirements: unknown, overrides: Record<string, unknown> = {}) => ({ id: 'policy-a', integrationConfigId: 'config-a', anchorRequirements: requirements, enabled: true, lifecycle: 'active', version: 1, replacesPolicyId: null, ...overrides });

describe('Integration admission (T013/T014)', () => {
  it('matches all required verified anchors exactly and blocks selector A to B replay', async () => {
    const subject = identity([{ kind: 'organization', value: 'org-a' }, { kind: 'tenant', value: 'tenant-a' }]);
    const service = admission({ 'config-a': [policy([{ kind: 'organization', allowedValues: ['org-a'] }, { kind: 'tenant', allowedValues: ['tenant-a'] }])], 'config-b': [policy([{ kind: 'organization', allowedValues: ['org-b'] }])] });
    await expect(service.admit({ identity: subject, integrationConfigId: 'config-a' })).resolves.toBeUndefined();
    await expect(service.admit({ identity: subject, integrationConfigId: 'config-b' })).rejects.toBeInstanceOf(ManagedExchangeIdentityDeniedError);
  });

  it('safely deduplicates identical verified anchors', async () => {
    const service = admission({ 'config-a': [policy([{ kind: 'organization', allowedValues: ['org-a'] }])] });
    await expect(service.admit({ identity: identity([{ kind: 'organization', value: 'org-a' }, { kind: 'organization', value: 'org-a' }]), integrationConfigId: 'config-a' })).resolves.toBeUndefined();
  });

  it.each([
    { anchors: [{ kind: 'organization', value: 'org-b' }], requirements: [{ kind: 'organization', allowedValues: ['org-a'] }] },
    { anchors: [{ kind: 'tenant', value: 'tenant-a' }], requirements: [{ kind: 'organization', allowedValues: ['org-a'] }] },
    { anchors: [{ kind: 'organization', value: 'org-a' }], requirements: [{ kind: 'organization', allowedValues: ['org-a'] }, { kind: 'tenant', allowedValues: ['tenant-a'] }] },
    { anchors: [{ kind: 'organization', value: 'org-a' }, { kind: 'organization', value: 'org-b' }], requirements: [{ kind: 'organization', allowedValues: ['org-a'] }] }
  ])('denies wrong, missing, partial, or conflicting anchors', async ({ anchors, requirements }) => {
    await expect(admission({ 'config-a': [policy(requirements)] }).admit({ identity: identity(anchors), integrationConfigId: 'config-a' })).rejects.toBeInstanceOf(ManagedExchangeIdentityDeniedError);
  });

  it.each([
    [[]],
    [[policy([])]],
    [[policy([{ kind: 'organization', allowedValues: [] }])]],
    [[policy([{ kind: 'organization', allowedValues: ['org-a'] }]), policy([{ kind: 'organization', allowedValues: ['org-a'] }])]]
  ])('denies absent, malformed, or ambiguous active policy', async (policies) => {
    await expect(admission({ 'config-a': policies }).admit({ identity: identity([{ kind: 'organization', value: 'org-a' }]), integrationConfigId: 'config-a' })).rejects.toBeInstanceOf(ManagedExchangeIdentityDeniedError);
  });

  it.each([
    [[{ kind: '', allowedValues: ['org-a'] }]],
    [[{ kind: 'organization', allowedValues: [''] }]],
    [[{ kind: 'organization', allowedValues: ['org-a'] }, { kind: 'organization', allowedValues: ['org-a'] }]],
    [[{ kind: 'organization', allowedValues: ['org-a', 'org-a'] }]]
  ])('denies empty, duplicate-kind, or duplicate-value persisted requirements', async (requirements) => {
    await expect(admission({ 'config-a': [policy(requirements)] }).admit({ identity: identity([{ kind: 'organization', value: 'org-a' }]), integrationConfigId: 'config-a' })).rejects.toBeInstanceOf(ManagedExchangeIdentityDeniedError);
  });

  it.each([
    policy([{ kind: 'organization', allowedValues: ['org-a'] }], { enabled: false }),
    policy([{ kind: 'organization', allowedValues: ['org-a'] }], { lifecycle: 'replaced' }),
    policy([{ kind: 'organization', allowedValues: ['org-a'] }], { integrationConfigId: 'config-b' })
  ])('denies disabled, replaced, or cross-config records returned by a faulty active read', async (record) => {
    const service = new IntegrationAdmissionService({ findEnabledActiveByConfigId: async () => [record] } as never);
    await expect(service.admit({ identity: identity([{ kind: 'organization', value: 'org-a' }]), integrationConfigId: 'config-a' })).rejects.toBeInstanceOf(ManagedExchangeIdentityDeniedError);
  });

  it('does not treat subject, organization field, or customer/browser-like data as anchor authority', async () => {
    const forged = identity([{ kind: 'tenant', value: 'tenant-a' }], { customerId: 'customer-a', browserHostApp: 'admin' });
    await expect(admission({ 'config-a': [policy([{ kind: 'organization', allowedValues: ['org-a'] }])] }).admit({ identity: forged, integrationConfigId: 'config-a' })).rejects.toBeInstanceOf(ManagedExchangeIdentityDeniedError);
  });

  it('uses typed infrastructure failure and has no forbidden authority references', async () => {
    const service = new IntegrationAdmissionService({ findEnabledActiveByConfigId: async () => { throw new Error('db unavailable'); } } as never);
    await expect(service.admit({ identity: identity([{ kind: 'organization', value: 'org-a' }]), integrationConfigId: 'config-a' })).rejects.toBeInstanceOf(ManagedExchangeInfrastructureError);
    const source = readFileSync(resolve(__dirname, '../../src/managed-identity-exchange/admission/integration-admission.service.ts'), 'utf8');
    expect(source).not.toMatch(/Customer|CustomerScope|nativeCredential|Authorization|PageContext|IDX|ES512|jwt|decode/i);
  });
});

describe('Feature 006 exact IDX Entry admission (T030/T031)', () => {
  it('admits one adapter-produced Entry A identity for config A and denies replay through config B', async () => {
    const { identity: verifiedIdentity, execute } = await adapterProducedIdentity();
    const findEnabledActiveByConfigId = jest.fn(async (configId: string) => ({
      'config-idx-a': [policy([{ kind: 'idx_entry', allowedValues: ['entry-a'] }], { id: 'policy-idx-a', integrationConfigId: 'config-idx-a' })],
      'config-idx-b': [policy([{ kind: 'idx_entry', allowedValues: ['entry-b'] }], { id: 'policy-idx-b', integrationConfigId: 'config-idx-b' })]
    })[configId] ?? []);
    const service = new IntegrationAdmissionService({ findEnabledActiveByConfigId } as never);
    const configAInput = Object.freeze({ identity: verifiedIdentity, integrationConfigId: 'config-idx-a' });
    const configBInput = Object.freeze({ identity: verifiedIdentity, integrationConfigId: 'config-idx-b' });

    expect(verifiedIdentity).toMatchObject({
      subject: 'idx-user-a',
      organization: 'company-shared',
      anchors: [{ kind: 'idx_entry', value: 'entry-a' }]
    });
    expect(Object.keys(configAInput).sort()).toEqual(['identity', 'integrationConfigId']);
    await expect(service.admit(configAInput)).resolves.toBeUndefined();
    await expect(service.admit(configBInput)).rejects.toBeInstanceOf(ManagedExchangeIdentityDeniedError);
    expect(findEnabledActiveByConfigId.mock.calls).toEqual([['config-idx-a'], ['config-idx-b']]);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['UUID_Company string equals Entry but the verified idx_entry differs', identity([{ kind: 'idx_entry', value: 'entry-b' }], { organization: 'entry-a' })],
    ['same value is carried by an organization anchor', identity([{ kind: 'organization', value: 'entry-a' }], { organization: 'entry-a' })],
    ['idx_entry is missing', identity([{ kind: 'tenant', value: 'entry-a' }], { organization: 'entry-a' })],
    ['idx_entry values conflict', identity([{ kind: 'idx_entry', value: 'entry-a' }, { kind: 'idx_entry', value: 'entry-b' }])],
    ['hostile Customer-like fields accompany the wrong Entry', identity([{ kind: 'idx_entry', value: 'entry-b' }], { customerId: 'entry-a', customer_id: 'entry-a', integrationId: 'config-idx-a', host_app: 'admin' })]
  ])('denies when %s', async (_caseName, candidate) => {
    const service = admission({
      'config-idx-a': [policy([{ kind: 'idx_entry', allowedValues: ['entry-a'] }], { id: 'policy-idx-a', integrationConfigId: 'config-idx-a' })]
    });
    await expect(service.admit({ identity: candidate, integrationConfigId: 'config-idx-a' })).rejects.toBeInstanceOf(ManagedExchangeIdentityDeniedError);
  });

  it('keeps production admission generic and free of provider, claim, permission, and Customer authority', () => {
    const source = readFileSync(resolve(__dirname, '../../src/managed-identity-exchange/admission/integration-admission.service.ts'), 'utf8');
    expect(source).not.toMatch(/Customer|CustomerScope|customerId|nativeCredential|Authorization|PageContext|IDX|idx_entry|UUID_Entry|UUID_Company|MenuDetail|providerType|idx_delegated|jwt|decode|trustedPermissionMaterial|permissionScopes|UserType|IsAdmin/i);
    expect(source).not.toMatch(/IdxDelegatedVerificationAdapter/);
  });
});

function admission(policies: Record<string, readonly ReturnType<typeof policy>[]>) {
  return new IntegrationAdmissionService({ findEnabledActiveByConfigId: async (id: string) => policies[id] ?? [] } as never);
}

async function adapterProducedIdentity() {
  const execute = jest.fn(async () => ({ status: 200, contentType: 'application/json', body: productionMenuDetail() }));
  const adapter = new IdxDelegatedVerificationAdapter({ execute } as never, new IdxMenuDetailValidator());
  const nativeCredential = compactToken({ sub: 'idx-user-a', UUID_User: 'idx-user-a', UUID_Company: 'company-shared', UUID_Entry: 'entry-a' });
  const verifiedIdentity = await adapter.verify({
    nativeCredential,
    requestId: 'request-idx-entry-a',
    providerInstancePolicy: {
      id: 'provider-idx', providerType: 'idx_delegated', endpointUri: 'https://provider.example.test/menu-detail', httpMethod: 'GET',
      credentialPlacement: 'authorization_bearer', timeoutMilliseconds: 1_000, responseContractVersion: 'idx-menu-detail/v1',
      declaredAnchorKinds: ['idx_entry'], providerContract: { responseSchema: 'idx-menu-detail/v1', contentType: 'application/json' }
    }
  } as never);
  return { identity: verifiedIdentity, execute };
}

function compactToken(payload: Record<string, unknown>): string {
  return `${Buffer.from(JSON.stringify({ alg: 'ES512', typ: 'JWT' }), 'utf8').toString('base64url')}.${Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')}.signature`;
}

function productionMenuDetail() {
  return {
    Code: 200, ExecutionTime: '12ms', Message: '', Version: '1.0.0', Data: [{
      UUID: 'menu-uuid', MenuID: 'SCM_ORDERS', Category: 'SCM', Patrilineal: null, Sorting: '120', Memo: 'Orders',
      MenuNode: [{ UUID: 'node-uuid', UUID_Menu: 'menu-uuid', Language: 'language-uuid', MenuName: 'Orders', Icon: 'assignment', ProgramCode: null, ProgramPath: '/orders', StartMethod: null, Memo: 'Orders' }],
      MenuPermission: { UUID: 'permission-uuid', UUID_Menu: 'menu-uuid', Insert: 'N', Update: 'Y', Delete: 'N', Print: 'N', Import: 'N', Export: 'Y', Copy: 'N', Approval: 'Y', Others: null, Memo: 'Orders' }
    }]
  };
}
