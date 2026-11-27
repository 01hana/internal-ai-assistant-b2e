import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ADMIN_ACTIONS,
  ADMIN_SUBJECTS,
  ALL_MANAGE,
  coversPermissions,
  effectivePermissions,
  formatPermission,
  normalizeCustomGroupPermissions,
  parsePermission,
  permissionCatalog,
  SYSTEM_GROUP_CODES,
  SYSTEM_GROUPS,
  toCaslRules
} from '../../src/admin/permissions';

/** Feature 014 T004–T005: the single source of admin back-office permissions (`src/admin/permissions`). */
const permissionsRoot = join(process.cwd(), 'src', 'admin', 'permissions');

describe('admin permissions', () => {
  it('stays free of framework and database code', () => {
    const sources = readdirSync(permissionsRoot).map((file) => readFileSync(join(permissionsRoot, file), 'utf8')).join('\n');
    expect(sources).not.toMatch(/from ['"](?:@nestjs|@prisma|@casl|\.\.\/)/);
  });

  it('has only the four actions, and every subject uses only them', () => {
    expect(ADMIN_ACTIONS).toEqual(['read', 'create', 'update', 'delete']);
    for (const definition of Object.values(ADMIN_SUBJECTS)) {
      for (const action of definition.actions) expect(ADMIN_ACTIONS).toContain(action);
    }
  });

  it('registers the subjects and actions of the spec permission table', () => {
    expect(Object.fromEntries(Object.entries(ADMIN_SUBJECTS).map(([subject, { actions }]) => [subject, [...actions]]))).toEqual({
      User: ['read', 'create', 'update', 'delete'],
      UserGroup: ['read', 'create', 'update', 'delete'],
      AuditEvent: ['read'],
      Stats: ['read'],
      Conversation: ['read'],
      ReviewItem: ['read', 'update'],
      Feedback: ['read'],
      ExperienceConfig: ['read', 'update']
    });
    expect(permissionCatalog().map((entry) => entry.subject)).toEqual(Object.keys(ADMIN_SUBJECTS));
    expect(permissionCatalog().every((entry) => entry.label.length > 0)).toBe(true);
  });

  it.each([
    ['User:read', { subject: 'User', action: 'read' }],
    ['Conversation:read', { subject: 'Conversation', action: 'read' }],
    ['UserGroup:manage', { subject: 'UserGroup', action: 'manage' }],
    ['all:manage', { subject: 'all', action: 'manage' }]
  ])('parses %s and formats it back', (value, expected) => {
    expect(parsePermission(value)).toEqual(expected);
    expect(formatPermission(parsePermission(value)!)).toBe(value);
  });

  it.each(['Conversation:readContent', 'ReviewItem:resolve', 'ExperienceConfig:activate', 'ExperienceConfig:create', 'User:assignGroup',
    'Conversation:update', 'Unknown:read', 'all:read', 'User', 'User:read:extra', ''])('rejects %s', (value) => {
    expect(parsePermission(value)).toBeNull();
  });

  it('normalises custom group permissions: expands manage, removes duplicates, keeps catalogue order', () => {
    expect(normalizeCustomGroupPermissions(['Feedback:read', 'User:manage', 'Conversation:read', 'User:read'])).toEqual({
      ok: true,
      permissions: ['User:read', 'User:create', 'User:update', 'User:delete', 'Conversation:read', 'Feedback:read']
    });
    expect(normalizeCustomGroupPermissions([])).toEqual({ ok: true, permissions: [] });
  });

  it('keeps all:manage for the built-in groups and rejects unknown permissions in custom groups', () => {
    expect(normalizeCustomGroupPermissions(['User:read', ALL_MANAGE, 'Conversation:readContent'])).toEqual({
      ok: false, invalid: [ALL_MANAGE, 'Conversation:readContent']
    });
  });

  it('defines exactly the developer and admin built-in groups, both with every permission', () => {
    expect(SYSTEM_GROUP_CODES).toEqual(['developer', 'admin']);
    expect(SYSTEM_GROUPS.developer).toMatchObject({ code: 'developer', name: '開發工程師', permissions: [ALL_MANAGE] });
    expect(SYSTEM_GROUPS.admin).toMatchObject({ code: 'admin', name: '最高管理者', permissions: [ALL_MANAGE] });
  });

  it('takes built-in group permissions from the contract, never from the stored row', () => {
    expect(effectivePermissions([{ code: 'admin', permissions: [] }])).toEqual([{ subject: 'all', action: 'manage' }]);
    expect(effectivePermissions([{ code: 'developer', permissions: ['Feedback:read'] }])).toEqual([{ subject: 'all', action: 'manage' }]);
  });

  it('unions custom groups and ignores stored strings the contract no longer knows', () => {
    const permissions = effectivePermissions([
      { code: null, permissions: ['Conversation:read', 'Feedback:read'] },
      { code: null, permissions: ['Feedback:read', 'ReviewItem:update', 'Legacy:read'] }
    ]);
    expect(permissions.map(formatPermission)).toEqual(['Conversation:read', 'Feedback:read', 'ReviewItem:update']);
    expect(toCaslRules(permissions)).toEqual([
      { action: 'read', subject: 'Conversation' }, { action: 'read', subject: 'Feedback' }, { action: 'update', subject: 'ReviewItem' }
    ]);
    expect(effectivePermissions([])).toEqual([]);
  });

  it('covers only permissions the holder has; all:manage covers everything', () => {
    const custom = (...permissions: string[]) => effectivePermissions([{ code: null, permissions }]);
    const admin = effectivePermissions([{ code: 'admin', permissions: [] }]);
    const held = custom('User:read', 'User:update', 'UserGroup:read');
    expect(coversPermissions(held, custom('User:read'))).toBe(true);
    expect(coversPermissions(held, custom())).toBe(true);
    expect(coversPermissions(held, custom('User:read', 'User:delete'))).toBe(false);
    expect(coversPermissions(held, admin)).toBe(false);
    expect(coversPermissions(admin, custom('User:delete', 'UserGroup:delete'))).toBe(true);
    expect(coversPermissions(admin, effectivePermissions([{ code: 'developer', permissions: [] }]))).toBe(true);
  });
});
