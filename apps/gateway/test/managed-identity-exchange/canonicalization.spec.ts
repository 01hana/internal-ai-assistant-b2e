import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  createVerifiedExternalIdentity,
  ManagedExchangeIdentityDeniedError,
  ManagedExchangeInfrastructureError
} from '../../src/managed-identity-exchange/domain/managed-exchange.domain';
import { IntegrationAdmissionService } from '../../src/managed-identity-exchange/admission/integration-admission.service';
import { ManagedCanonicalizationService } from '../../src/managed-identity-exchange/canonicalization/managed-canonicalization.service';

const config = (overrides: Record<string, unknown> = {}) => ({
  id: 'config-a',
  publicSelector: 'selector-a',
  integrationId: 'integration-a',
  providerInstanceId: 'provider-a',
  canonicalHostApp: 'admin',
  organizationMode: 'verified',
  fixedOrganizationId: null,
  enabled: true,
  lifecycle: 'active',
  version: 1,
  replacesConfigId: null,
  ...overrides
});
const identity = (overrides: Record<string, unknown> = {}) => createVerifiedExternalIdentity({
  subject: 'actor-a',
  organization: 'org-a',
  anchors: [{ kind: 'organization', value: 'org-a' }],
  ...overrides
});

describe('Managed canonicalization (T015/T016)', () => {
  it('projects verified organization into exactly the six frozen canonical fields', async () => {
    const result = await canonicalizer(config()).canonicalize({ identity: identity(), integrationConfigId: 'config-a', permissionScopes: [] });
    expect(result).toEqual({ integrationId: 'integration-a', subject: 'actor-a', organizationId: 'org-a', hostApp: 'admin', roles: [], permissionScopes: [] });
    expect(Object.keys(result).sort()).toEqual(['hostApp', 'integrationId', 'organizationId', 'permissionScopes', 'roles', 'subject']);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.roles)).toBe(true);
    expect(Object.isFrozen(result.permissionScopes)).toBe(true);
  });

  it('uses only the registered fixed single-organization value', async () => {
    const result = await canonicalizer(config({ organizationMode: 'fixed_single_organization', fixedOrganizationId: 'org-fixed' })).canonicalize({
      identity: identity({ organization: 'forged-org' }), integrationConfigId: 'config-a', permissionScopes: []
    });
    expect(result.organizationId).toBe('org-fixed');
  });

  it.each([
    [null],
    [config({ enabled: false })],
    [config({ lifecycle: 'replaced' })],
    [config({ lifecycle: 'draft' })],
    [config({ id: 'config-b' })],
    [config({ integrationId: '   ' })],
    [config({ canonicalHostApp: '   ' })],
    [config({ organizationMode: 'verified', fixedOrganizationId: 'org-fixed' })],
    [config({ organizationMode: 'fixed_single_organization', fixedOrganizationId: null })],
    [config({ organizationMode: 'unknown' })]
  ])('denies missing, inactive, malformed, or cross-config records', async (record) => {
    await expect(canonicalizer(record).canonicalize({ identity: identity(), integrationConfigId: 'config-a', permissionScopes: [] })).rejects.toBeInstanceOf(ManagedExchangeIdentityDeniedError);
  });

  it.each([
    [config(), { subject: 'actor-a', organization: undefined }]
  ])('denies invalid verified organization input without falling back or guessing', async (record, rawIdentity) => {
    await expect(canonicalizer(record).canonicalize({ identity: rawIdentity as never, integrationConfigId: 'config-a', permissionScopes: [] })).rejects.toBeInstanceOf(ManagedExchangeIdentityDeniedError);
  });

  it.each([
    { subject: '   ', organization: 'org-a', anchors: [{ kind: 'organization', value: 'org-a' }] },
    { subject: 'actor\u0000a', organization: 'org-a', anchors: [{ kind: 'organization', value: 'org-a' }] }
  ])('defensively denies blank or control-character subjects', async (rawIdentity) => {
    await expect(canonicalizer(config()).canonicalize({ identity: rawIdentity as never, integrationConfigId: 'config-a', permissionScopes: [] })).rejects.toBeInstanceOf(ManagedExchangeIdentityDeniedError);
  });

  it('ignores forged browser, native, Customer-like, and role-like identity fields', async () => {
    const forged = identity({
      sub: 'forged-subject', integrationId: 'integration-b', integration_id: 'integration-b', org_id: 'forged-org', host_app: 'forged-app',
      customerId: 'customer-b', customer_id: 'customer-b', roles: ['admin'], permission_scopes: ['root:*'], UserType: 'Admin', IsAdmin: 'Y'
    });
    const result = await canonicalizer(config()).canonicalize({ identity: forged, integrationConfigId: 'config-a', permissionScopes: [] });
    expect(result).toEqual({ integrationId: 'integration-a', subject: 'actor-a', organizationId: 'org-a', hostApp: 'admin', roles: [], permissionScopes: [] });
  });

  it('copies, validates, and freezes trusted permission scopes without transformation', async () => {
    const scopes = ['orders:read', 'orders:update'];
    const result = await canonicalizer(config()).canonicalize({ identity: identity(), integrationConfigId: 'config-a', permissionScopes: scopes });
    scopes.push('root:*');
    expect(result.permissionScopes).toEqual(['orders:read', 'orders:update']);
    await expect(canonicalizer(config()).canonicalize({ identity: identity(), integrationConfigId: 'config-a', permissionScopes: [''] })).rejects.toBeInstanceOf(ManagedExchangeIdentityDeniedError);
    await expect(canonicalizer(config()).canonicalize({ identity: identity(), integrationConfigId: 'config-a', permissionScopes: ['   '] })).rejects.toBeInstanceOf(ManagedExchangeIdentityDeniedError);
    await expect(canonicalizer(config()).canonicalize({ identity: identity(), integrationConfigId: 'config-a', permissionScopes: ['orders:\u0000read'] })).rejects.toBeInstanceOf(ManagedExchangeIdentityDeniedError);
    await expect(canonicalizer(config()).canonicalize({ identity: identity(), integrationConfigId: 'config-a', permissionScopes: [123] as never })).rejects.toBeInstanceOf(ManagedExchangeIdentityDeniedError);
  });

  it('maps repository failure to infrastructure error and has no forbidden authority references', async () => {
    const unavailable = new ManagedCanonicalizationService({ findById: async () => { throw new Error('db unavailable'); } } as never);
    await expect(unavailable.canonicalize({ identity: identity(), integrationConfigId: 'config-a', permissionScopes: [] })).rejects.toBeInstanceOf(ManagedExchangeInfrastructureError);
    const source = readFileSync(resolve(__dirname, '../../src/managed-identity-exchange/canonicalization/managed-canonicalization.service.ts'), 'utf8');
    expect(source).not.toMatch(/Customer|CustomerScope|IntegrationBinding|CanonicalIdentityResolver|nativeCredential|Authorization|PageContext|IDX|ES512|UserType|IsAdmin|decodeJwt|jwt/i);
  });

  it('retains selector A-to-B replay prevention before canonicalization', async () => {
    const admission = new IntegrationAdmissionService({
      findEnabledActiveByConfigId: async (id: string) => id === 'config-a'
        ? [{ id: 'policy-a', integrationConfigId: 'config-a', anchorRequirements: [{ kind: 'organization', allowedValues: ['org-a'] }], enabled: true, lifecycle: 'active', version: 1, replacesPolicyId: null }]
        : [{ id: 'policy-b', integrationConfigId: 'config-b', anchorRequirements: [{ kind: 'organization', allowedValues: ['org-b'] }], enabled: true, lifecycle: 'active', version: 1, replacesPolicyId: null }]
    } as never);
    const service = canonicalizer(config());
    const invokeCanonicalization = jest.fn((input: Readonly<{ identity: ReturnType<typeof identity>; integrationConfigId: string; permissionScopes: readonly string[] }>) => service.canonicalize(input));
    const verified = identity();
    await admission.admit({ identity: verified, integrationConfigId: 'config-a' });
    await expect(invokeCanonicalization({ identity: verified, integrationConfigId: 'config-a', permissionScopes: [] })).resolves.toBeDefined();
    await expect(admission.admit({ identity: verified, integrationConfigId: 'config-b' })).rejects.toBeInstanceOf(ManagedExchangeIdentityDeniedError);
    expect(invokeCanonicalization).toHaveBeenCalledTimes(1);
  });
});

function canonicalizer(record: ReturnType<typeof config> | null) {
  return new ManagedCanonicalizationService({ findById: async () => record } as never);
}
