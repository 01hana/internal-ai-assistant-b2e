import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ManagedExchangeIdentityDeniedError, type PermissionNormalizer, type TrustedPermissionMaterial } from '../../src/managed-identity-exchange/domain/managed-exchange.domain';
import { ManagedPermissionScopeProjector } from '../../src/managed-identity-exchange/permissions/managed-permission-scope.projector';
import { PermissionNormalizerRegistry } from '../../src/managed-identity-exchange/permissions/permission-normalizer.registry';
import { SyntheticV1PermissionNormalizer } from '../../src/managed-identity-exchange/permissions/synthetic-v1-permission.normalizer';

const normalizerPath = resolve(__dirname, '../../src/managed-identity-exchange/permissions/synthetic-v1-permission.normalizer.ts');
const registryPath = resolve(__dirname, '../../src/managed-identity-exchange/permissions/permission-normalizer.registry.ts');
const projectorPath = resolve(__dirname, '../../src/managed-identity-exchange/permissions/managed-permission-scope.projector.ts');
const idxNormalizerPath = resolve(__dirname, '../../src/managed-identity-exchange/permissions/idx-menu-detail.permission-normalizer.ts');
const contract = Object.freeze({ scopeSchema: 'managed-normalized-scopes/v1' });
const idxActions = Object.freeze(['read', 'insert', 'update', 'delete', 'print', 'import', 'export', 'copy', 'approval'] as const);

describe('Immutable permission normalization and scope projection (T025)', () => {
  it('T025 loads the fixed production IDX permission normalizer', () => {
    expect(idxNormalizer().normalizerType).toBe('idx-menu-detail/v1');
  });

  it('T025 projects the closed canonical menu subject through the generic projector', () => {
    expect(new ManagedPermissionScopeProjector().project(
      [{ subject: 'menu:SCM_ORDERS', action: 'read' }],
      'managed-permissions/v1',
      contract
    )).toEqual(['menu:SCM_ORDERS:read']);
  });

  it('T025 normalizes representative semantic IDX material with exact immutable output', () => {
    const normalized = idxNormalizer().normalize(idxMaterial([{
      menuId: 'SCM_ORDERS', actions: ['read', 'update', 'export', 'approval']
    }]));
    expect(normalized).toEqual([
      { subject: 'menu:SCM_ORDERS', action: 'read' },
      { subject: 'menu:SCM_ORDERS', action: 'update' },
      { subject: 'menu:SCM_ORDERS', action: 'export' },
      { subject: 'menu:SCM_ORDERS', action: 'approval' }
    ]);
    expect(Object.isFrozen(normalized)).toBe(true);
    expect(normalized.every(Object.isFrozen)).toBe(true);
    expect(normalized.every((permission) => Reflect.ownKeys(permission).sort().join(',') === 'action,subject')).toBe(true);
  });

  it('T025 covers every fixed action without inventing permission or role authority', () => {
    const normalized = idxNormalizer().normalize(idxMaterial([{ menuId: 'SCM_ALL', actions: idxActions }]));
    expect(normalized).toEqual(idxActions.map((action) => ({ subject: 'menu:SCM_ALL', action })));
    expect(normalized.map(({ action }) => action)).not.toEqual(expect.arrayContaining(['write', 'approve', 'admin', 'all', '*', 'role']));
    expect(normalized).not.toHaveProperty('roles');
  });

  it('T025 retains implicit read for an all-N menu and accepts authoritative empty material', () => {
    const normalizer = idxNormalizer();
    const readOnly = normalizer.normalize(idxMaterial([{ menuId: 'SCM_READ_ONLY', actions: ['read'] }]));
    const empty = normalizer.normalize(idxMaterial([]));
    expect(readOnly).toEqual([{ subject: 'menu:SCM_READ_ONLY', action: 'read' }]);
    expect(empty).toEqual([]);
    expect(Object.isFrozen(readOnly)).toBe(true);
    expect(Object.isFrozen(empty)).toBe(true);
  });

  it('T025 aggregates duplicate records before deterministic MenuID and action sorting', () => {
    expect(idxNormalizer().normalize(idxMaterial([
      { menuId: 'SCM_Z', actions: ['read', 'delete'] },
      { menuId: 'SCM_A', actions: ['read', 'update'] },
      { menuId: 'SCM_A', actions: ['read', 'insert', 'update'] }
    ]))).toEqual([
      { subject: 'menu:SCM_A', action: 'read' },
      { subject: 'menu:SCM_A', action: 'insert' },
      { subject: 'menu:SCM_A', action: 'update' },
      { subject: 'menu:SCM_Z', action: 'read' },
      { subject: 'menu:SCM_Z', action: 'delete' }
    ]);
  });

  it('T025 preserves MenuID case and uses deterministic ordinal ordering', () => {
    expect(idxNormalizer().normalize(idxMaterial([
      { menuId: 'menu-b', actions: ['read'] },
      { menuId: 'Menu-A', actions: ['read'] },
      { menuId: 'MENU_A', actions: ['read'] }
    ]))).toEqual([
      { subject: 'menu:MENU_A', action: 'read' },
      { subject: 'menu:Menu-A', action: 'read' },
      { subject: 'menu:menu-b', action: 'read' }
    ]);
  });

  it.each([
    ['wrong kind', { kind: 'other/v1', menus: [] }],
    ['scalar material', { kind: 'managed-permission-material/v1', values: ['orders:read'] }],
    ['missing menus', { kind: 'idx-menu-detail/v1' }],
    ['non-array menus', { kind: 'idx-menu-detail/v1', menus: {} }],
    ['malformed menus array prototype', { kind: 'idx-menu-detail/v1', menus: Object.setPrototypeOf([], null) }],
    ['extra top-level key', { kind: 'idx-menu-detail/v1', menus: [], rawPayload: 'forbidden-sentinel' }],
    ['symbol top-level key', { kind: 'idx-menu-detail/v1', menus: [], [Symbol('extra')]: true }],
    ['malformed top-level prototype', Object.assign(Object.create({ inherited: true }), { kind: 'idx-menu-detail/v1', menus: [] })],
    ['non-object menu', { kind: 'idx-menu-detail/v1', menus: [null] }],
    ['unknown menu key', { kind: 'idx-menu-detail/v1', menus: [{ menuId: 'ORDERS', actions: ['read'], UUID: 'forbidden-sentinel' }] }],
    ['symbol menu key', { kind: 'idx-menu-detail/v1', menus: [{ menuId: 'ORDERS', actions: ['read'], [Symbol('extra')]: true }] }],
    ['malformed menu prototype', { kind: 'idx-menu-detail/v1', menus: [Object.assign(Object.create({ inherited: true }), { menuId: 'ORDERS', actions: ['read'] })] }],
    ['blank MenuID', { kind: 'idx-menu-detail/v1', menus: [{ menuId: '   ', actions: ['read'] }] }],
    ['non-string MenuID', { kind: 'idx-menu-detail/v1', menus: [{ menuId: 42, actions: ['read'] }] }],
    ['noncanonical MenuID', { kind: 'idx-menu-detail/v1', menus: [{ menuId: ' ORDERS', actions: ['read'] }] }],
    ['control MenuID', { kind: 'idx-menu-detail/v1', menus: [{ menuId: 'ORDERS\u0000', actions: ['read'] }] }],
    ['colon MenuID', { kind: 'idx-menu-detail/v1', menus: [{ menuId: 'SCM:ORDERS', actions: ['read'] }] }],
    ['non-array actions', { kind: 'idx-menu-detail/v1', menus: [{ menuId: 'ORDERS', actions: 'read' }] }],
    ['malformed actions array prototype', { kind: 'idx-menu-detail/v1', menus: [{ menuId: 'ORDERS', actions: Object.setPrototypeOf(['read'], null) }] }],
    ['missing read', { kind: 'idx-menu-detail/v1', menus: [{ menuId: 'ORDERS', actions: ['update'] }] }],
    ['unknown action', { kind: 'idx-menu-detail/v1', menus: [{ menuId: 'ORDERS', actions: ['read', 'write'] }] }],
    ['non-string action', { kind: 'idx-menu-detail/v1', menus: [{ menuId: 'ORDERS', actions: ['read', 1] }] }],
    ['duplicate action', { kind: 'idx-menu-detail/v1', menus: [{ menuId: 'ORDERS', actions: ['read', 'read'] }] }],
    ['noncanonical action order', { kind: 'idx-menu-detail/v1', menus: [{ menuId: 'ORDERS', actions: ['read', 'update', 'insert'] }] }],
    ['raw MenuDetail response', { Code: 200, Data: [] }]
  ])('T025 denies malformed IDX material: %s', (_caseName, invalid) => {
    let failure: unknown;
    try { idxNormalizer().normalize(invalid as TrustedPermissionMaterial); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(ManagedExchangeIdentityDeniedError);
    expect(`${String(failure)} ${JSON.stringify(failure)}`).not.toContain('forbidden-sentinel');
  });

  it('T025 normalizes and projects exact deterministic canonical menu scopes', () => {
    const normalized = idxNormalizer().normalize(idxMaterial([{
      menuId: 'SCM_ORDERS', actions: ['read', 'update', 'export']
    }]));
    const scopes = new ManagedPermissionScopeProjector().project(normalized, 'managed-permissions/v1', contract);
    expect(normalized).toEqual([
      { subject: 'menu:SCM_ORDERS', action: 'read' },
      { subject: 'menu:SCM_ORDERS', action: 'update' },
      { subject: 'menu:SCM_ORDERS', action: 'export' }
    ]);
    expect(scopes).toEqual(['menu:SCM_ORDERS:read', 'menu:SCM_ORDERS:update', 'menu:SCM_ORDERS:export']);
    expect(Object.isFrozen(scopes)).toBe(true);
    expect(JSON.stringify(scopes)).not.toMatch(/UUID|customer-a|integration-a|UserType|IsAdmin|Permission_Hash|native.?token|roles/i);
  });

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
    [[{ subject: 'menu:', action: 'read' }], 'managed-permissions/v1', contract],
    [[{ subject: 'menu::ORDERS', action: 'read' }], 'managed-permissions/v1', contract],
    [[{ subject: 'menu:ORDERS:EXTRA', action: 'read' }], 'managed-permissions/v1', contract],
    [[{ subject: ':ORDERS', action: 'read' }], 'managed-permissions/v1', contract],
    [[{ subject: 'foo:ORDERS', action: 'read' }], 'managed-permissions/v1', contract],
    [[{ subject: 'menu: ORDERS', action: 'read' }], 'managed-permissions/v1', contract],
    [[{ subject: 'menu:ORDERS ', action: 'read' }], 'managed-permissions/v1', contract],
    [[{ subject: 'menu:ORDERS\u0000', action: 'read' }], 'managed-permissions/v1', contract],
    [[{ subject: 'orders', action: 'read' }], 'managed-permissions/v1', {}],
    [[{ subject: 'orders', action: 'read' }], 'other/v1', contract]
  ])('denies malformed normalized permissions or projection contracts', (permissions, version, projection) => {
    expect(() => new ManagedPermissionScopeProjector().project(permissions as never, version, projection as never)).toThrow(ManagedExchangeIdentityDeniedError);
  });

  it('preserves legacy subject normalization, ordering, and deduplication', () => {
    expect(new ManagedPermissionScopeProjector().project([
      { subject: ' orders ', action: 'read' },
      { subject: 'inventory', action: 'update' },
      { subject: 'orders', action: 'read' }
    ], 'managed-permissions/v1', contract)).toEqual(['orders:read', 'inventory:update']);
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

  it('resolves the production IDX normalizer only through direct unit composition', () => {
    const normalizer = idxNormalizer();
    const normalize = jest.spyOn(normalizer, 'normalize');
    const registry = new PermissionNormalizerRegistry([normalizer]);
    expect(registry.resolve('idx-menu-detail/v1')).toBe(normalizer);
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

    const idxSource = readFileSync(idxNormalizerPath, 'utf8');
    expect(idxSource).not.toMatch(/SCM|UUID|UUID_Menu|MenuPermission|MenuNode|Patrilineal|Category|Sorting|Memo|UserType|IsAdmin|Permissions|Permission_Hash|Customer|CustomerScope|IntegrationBinding|nativeCredential|Authorization|AccessToken|RefreshToken|raw.?JWT|DelegatedHttpTransport|IdxDelegatedVerificationAdapter|VerifyNativeCredentialInput|PermissionSource|ManagedTokenIssuer|GatewaySigningKey|roles/i);
  });
});

function material(overrides: Record<string, unknown> = {}): TrustedPermissionMaterial {
  return { kind: 'managed-permission-material/v1', reference: 'trusted-reference-a', values: ['orders:read', 'orders:update'], ...overrides } as TrustedPermissionMaterial;
}

function normalizer(normalizerType: string): PermissionNormalizer {
  return { normalizerType, normalize: jest.fn(() => Object.freeze([])) };
}

function idxNormalizer(): PermissionNormalizer {
  if (!existsSync(idxNormalizerPath)) throw new Error('Feature 006 production IDX permission normalizer is missing.');
  const target = require(idxNormalizerPath) as { IdxMenuDetailPermissionNormalizer: new () => PermissionNormalizer };
  return new target.IdxMenuDetailPermissionNormalizer();
}

function idxMaterial(menus: readonly Readonly<{ menuId: string; actions: readonly string[] }>[]): TrustedPermissionMaterial {
  return { kind: 'idx-menu-detail/v1', menus } as unknown as TrustedPermissionMaterial;
}
