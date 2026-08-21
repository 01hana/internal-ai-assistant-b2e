import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createVerifiedExternalIdentity, ManagedExchangeIdentityDeniedError, ManagedExchangeInfrastructureError } from '../../src/managed-identity-exchange/domain/managed-exchange.domain';
import { IntegrationAdmissionService } from '../../src/managed-identity-exchange/admission/integration-admission.service';

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

function admission(policies: Record<string, readonly ReturnType<typeof policy>[]>) {
  return new IntegrationAdmissionService({ findEnabledActiveByConfigId: async (id: string) => policies[id] ?? [] } as never);
}
