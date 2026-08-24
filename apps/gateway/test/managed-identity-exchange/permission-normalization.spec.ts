import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ManagedExchangeIdentityDeniedError, type PermissionNormalizer, type TrustedPermissionMaterial } from '../../src/managed-identity-exchange/domain/managed-exchange.domain';
import { ManagedPermissionScopeProjector } from '../../src/managed-identity-exchange/permissions/managed-permission-scope.projector';
import { PermissionNormalizerRegistry } from '../../src/managed-identity-exchange/permissions/permission-normalizer.registry';
import { SyntheticV1PermissionNormalizer } from '../../src/managed-identity-exchange/permissions/synthetic-v1-permission.normalizer';

const normalizerPath = resolve(__dirname, '../../src/managed-identity-exchange/permissions/synthetic-v1-permission.normalizer.ts');
const registryPath = resolve(__dirname, '../../src/managed-identity-exchange/permissions/permission-normalizer.registry.ts');
const projectorPath = resolve(__dirname, '../../src/managed-identity-exchange/permissions/managed-permission-scope.projector.ts');
const contract = Object.freeze({ scopeSchema: 'managed-normalized-scopes/v1' });

describe('Immutable permission normalization and scope projection (T025)', () => {
  it('normalizes trusted V1 material and projects deterministic immutable scopes', () => {
    const normalized = new SyntheticV1PermissionNormalizer().normalize(material());
    const scopes = new ManagedPermissionScopeProjector().project(normalized, 'managed-permissions/v1', contract);

    expect(normalized).toEqual([{ subject: 'orders', action: 'read' }, { subject: 'orders', action: 'update' }]);
    expect(scopes).toEqual(['orders:read', 'orders:update']);
    expect(Object.isFrozen(normalized)).toBe(true);
    expect(normalized.every(Object.isFrozen)).toBe(true);
    expect(Object.isFrozen(scopes)).toBe(true);
    expect(JSON.stringify({ normalized, scopes })).not.toMatch(/nativeCredential|authorization|customerId|rawJwt|UserType|IsAdmin/i);
  });

  it('deduplicates repeated permissions and scopes in first-seen order', () => {
    const normalized = new SyntheticV1PermissionNormalizer().normalize(material({ values: ['orders:read', 'orders:read', 'orders:update'] }));
    expect(normalized).toEqual([{ subject: 'orders', action: 'read' }, { subject: 'orders', action: 'update' }]);
    expect(new ManagedPermissionScopeProjector().project([{ subject: 'orders', action: 'read' }, { subject: 'orders', action: 'read' }], 'managed-permissions/v1', contract)).toEqual(['orders:read']);
  });

  it('allows trusted V1 material with no values as an immutable empty permission set', () => {
    const normalized = new SyntheticV1PermissionNormalizer().normalize(material({ values: undefined }));
    const scopes = new ManagedPermissionScopeProjector().project(normalized, 'managed-permissions/v1', contract);
    expect(normalized).toEqual([]);
    expect(scopes).toEqual([]);
    expect(Object.isFrozen(normalized)).toBe(true);
    expect(Object.isFrozen(scopes)).toBe(true);
  });

  it.each([
    material({ kind: 'other/v1' }), material({ values: [''] }), material({ values: ['orders:\u0000read'] }),
    material({ values: ['orders:read:extra'] }), { kind: 'managed-permission-material/v1', values: ['orders:read'], extra: true },
    { kind: 'managed-permission-material/v1', values: 'orders:read' }
  ])('denies malformed trusted material', (invalid) => {
    expect(() => new SyntheticV1PermissionNormalizer().normalize(invalid as TrustedPermissionMaterial)).toThrow(ManagedExchangeIdentityDeniedError);
  });

  it.each([
    [[{ subject: '', action: 'read' }], 'managed-permissions/v1', contract],
    [[{ subject: 'orders', action: 'read\u0000' }], 'managed-permissions/v1', contract],
    [[{ subject: 'orders', action: 'read', extra: true }], 'managed-permissions/v1', contract],
    [[{ subject: 'orders:sub', action: 'read' }], 'managed-permissions/v1', contract],
    [[{ subject: 'orders', action: 'read' }], 'managed-permissions/v1', {}],
    [[{ subject: 'orders', action: 'read' }], 'other/v1', contract]
  ])('denies malformed normalized permissions or projection contracts', (permissions, version, projection) => {
    expect(() => new ManagedPermissionScopeProjector().project(permissions as never, version, projection as never)).toThrow(ManagedExchangeIdentityDeniedError);
  });

  it('resolves exact fixed normalizers without invoking them', () => {
    const normalizer = new SyntheticV1PermissionNormalizer();
    const normalize = jest.spyOn(normalizer, 'normalize');
    const registry = new PermissionNormalizerRegistry([normalizer]);
    expect(registry.resolve('synthetic-normalizer/v1')).toBe(normalizer);
    expect(registry.resolve('synthetic-normalizer/v1')).toBe(normalizer);
    expect(registry.resolve('unknown')).toBeUndefined();
    expect(normalize).not.toHaveBeenCalled();
  });

  it('rejects blank and duplicate normalizer registrations', () => {
    expect(() => new PermissionNormalizerRegistry([normalizer('synthetic-normalizer/v1'), normalizer('synthetic-normalizer/v1')])).toThrow();
    expect(() => new PermissionNormalizerRegistry([normalizer('  ')])).toThrow();
  });

  it('has no registry mutation or fallback API', () => {
    expect(Object.getOwnPropertyNames(PermissionNormalizerRegistry.prototype)).toEqual(expect.arrayContaining(['constructor', 'resolve']));
    expect(Object.getOwnPropertyNames(PermissionNormalizerRegistry.prototype)).not.toEqual(expect.arrayContaining(['register', 'unregister']));
  });

  it('keeps normalizer and projector sources free of authority and dynamic mapping', () => {
    const source = [normalizerPath, registryPath, projectorPath].map((path) => readFileSync(path, 'utf8')).join('\n');
    expect(source).not.toMatch(/Customer|CustomerScope|IntegrationBinding|PageContext|nativeCredential|Authorization|VerifyNativeCredentialInput|DelegatedHttpTransport|IDX|UUID|SCM|UserType|IsAdmin|ManagedTokenIssuer|Canonicalization|eval\(|new Function|JSONPath|dynamic mapping|fallback|register\(|unregister\(|roles/i);
  });
});

function material(overrides: Record<string, unknown> = {}): TrustedPermissionMaterial {
  return { kind: 'managed-permission-material/v1', reference: 'trusted-reference-a', values: ['orders:read', 'orders:update'], ...overrides } as TrustedPermissionMaterial;
}

function normalizer(normalizerType: string): PermissionNormalizer {
  return { normalizerType, normalize: jest.fn(() => Object.freeze([])) };
}
