import { ManagedExchangeInfrastructureError } from '../../src/managed-identity-exchange/domain/managed-exchange.domain';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type SemanticMenu = Readonly<{ menuId: string; actions: readonly string[] }>;
type Validator = Readonly<{ validate(body: unknown): readonly SemanticMenu[] }>;

const operations = Object.freeze([
  ['Insert', 'insert'], ['Update', 'update'], ['Delete', 'delete'], ['Print', 'print'],
  ['Import', 'import'], ['Export', 'export'], ['Copy', 'copy'], ['Approval', 'approval'],
] as const);

describe('IDX MenuDetail semantic validator (T016)', () => {
  it('accepts the registered production-shaped response and returns only frozen menu semantics', () => {
    const raw = response([menu({ MenuID: 'SCM_ORDERS', MenuPermission: permission({ Update: 'Y', Export: 'Y', Approval: 'Y' }) })]);
    const result = validator().validate(raw);
    expect(result).toEqual([{ menuId: 'SCM_ORDERS', actions: ['read', 'update', 'export', 'approval'] }]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result[0])).toBe(true);
    expect(Object.isFrozen(result[0].actions)).toBe(true);
  });

  it('accepts the supplied child-menu shape without deriving authority from Patrilineal or MenuNode', () => {
    const raw = response([menu({
      UUID: 'company-menu-uuid', MenuID: 'SCM_COMPANY', Category: 'SCM', Patrilineal: 'parent-menu-uuid', Sorting: '181', Memo: '公司管理',
      MenuNode: [node({ UUID: 'company-node-uuid', UUID_Menu: 'company-menu-uuid', Language: 'language-uuid', MenuName: '公司管理', Icon: 'business', ProgramCode: null, ProgramPath: '/system/company', StartMethod: null, Memo: '公司管理' })],
      MenuPermission: permission({ UUID: 'company-permission-uuid', UUID_Menu: 'company-menu-uuid', Insert: 'Y', Update: 'Y', Delete: 'Y', Memo: 'SCM_COMPANY - Insert, Update, Delete' }),
    })]);

    expect(validator().validate(raw)).toEqual([{ menuId: 'SCM_COMPANY', actions: ['read', 'insert', 'update', 'delete'] }]);
  });

  it('accepts multiple records, trims MenuID, and discards every UUID and metadata value', () => {
    const rawMenuUuid = 'raw-menu-uuid-a';
    const raw = response([
      menu({ UUID: rawMenuUuid, MenuID: ' ORDERS ', MenuNode: [node({ UUID: 'raw-node-uuid', ProgramCode: 'ORDERS', StartMethod: 'open' })], MenuPermission: permission({ UUID: 'raw-permission-uuid', UUID_Menu: 'raw-permission-menu-uuid', Insert: 'Y', Memo: 'raw-permission-memo' }) }),
      menu({ MenuID: 'INVENTORY', Category: 'raw-category', MenuPermission: permission({ Update: 'Y', Export: 'Y' }) }),
    ]);
    const result = validator().validate(raw);
    expect(result).toEqual([{ menuId: 'ORDERS', actions: ['read', 'insert'] }, { menuId: 'INVENTORY', actions: ['read', 'update', 'export'] }]);
    expect(JSON.stringify(result)).not.toMatch(/raw-|UUID|ExecutionTime|Message|Version|MenuNode|MenuPermission|Language|Patrilineal|Category|Sorting|Memo|ProgramPath|ProgramCode|StartMethod/i);
    expect(result[0].menuId).not.toBe(rawMenuUuid);
  });

  it('keeps implicit read for all-N records and maps all-Y records in fixed action order', () => {
    expect(validator().validate(response([menu()]))).toEqual([{ menuId: 'ORDERS', actions: ['read'] }]);
    expect(validator().validate(response([menu({ MenuPermission: permission(Object.fromEntries(operations.map(([field]) => [field, 'Y']))) })]))).toEqual([
      { menuId: 'ORDERS', actions: ['read', 'insert', 'update', 'delete', 'print', 'import', 'export', 'copy', 'approval'] },
    ]);
  });

  it('retains duplicate records as frozen semantic records without retaining raw objects', () => {
    const result = validator().validate(response([menu({ MenuPermission: permission({ Insert: 'Y' }) }), menu({ MenuPermission: permission({ Insert: 'Y' }) })]));
    expect(result).toEqual([{ menuId: 'ORDERS', actions: ['read', 'insert'] }, { menuId: 'ORDERS', actions: ['read', 'insert'] }]);
    expect(Object.isFrozen(result[1])).toBe(true);
    expect(Object.isFrozen(result[1].actions)).toBe(true);
  });

  it.each([
    undefined, null, [], 'response', { Code: 200 }, { ...response([]), Code: '200' }, { ...response([]), Code: 400 }, { ...response([]), Code: 401 }, { ...response([]), Code: 500 },
    { ...response([]), Data: {} }, { ...response([]), Data: 'menus' }, { ...response([]), Data: [null] }, { ...response([]), Data: [7] }, { ...response([]), Data: [[]] },
    { ...response([]), ExecutionTime: null }, { ...response([]), Message: 7 }, { ...response([]), Version: {} }, { ...response([]), Extra: true },
  ])('rejects malformed or application-failure top-level response %o', (invalid) => expectInfrastructureError(invalid));

  it.each([
    menu({ MenuID: undefined }), menu({ MenuID: '' }), menu({ MenuID: '   ' }), menu({ MenuID: 7 }), menu({ MenuID: 'ORDER\u0000S' }), menu({ MenuID: 'ORDER\u001FS' }), menu({ MenuID: 'ORDER\u007FS' }),
    menu({ UUID: null }), menu({ Category: null }), menu({ Patrilineal: 7 }), menu({ Patrilineal: true }), menu({ Patrilineal: [] }), menu({ Patrilineal: {} }), menu({ Sorting: 120 }), menu({ Memo: null }), menu({ MenuNode: {} }), { ...menu(), Unknown: true },
  ])('rejects malformed or unknown registered menu records %o', (invalid) => expectInfrastructureError(response([invalid])));

  it.each([
    menu({ MenuPermission: undefined }), menu({ MenuPermission: null }), menu({ MenuPermission: [] }), menu({ MenuPermission: 'permission' }),
    menu({ MenuPermission: permission({ UUID: null }) }), menu({ MenuPermission: permission({ UUID_Menu: 7 }) }), menu({ MenuPermission: permission({ Others: 'not-null' }) }), menu({ MenuPermission: permission({ Memo: null }) }), menu({ MenuPermission: { ...permission(), Unknown: true } }),
  ])('rejects malformed or unknown MenuPermission objects %o', (invalid) => expectInfrastructureError(response([invalid])));

  it.each([
    menu({ MenuNode: [null] }), menu({ MenuNode: [7] }), menu({ MenuNode: [[]] }), menu({ MenuNode: [node({ UUID: null })] }), menu({ MenuNode: [omit(node(), 'Language')] }), menu({ MenuNode: [node({ Language: 7 })] }), menu({ MenuNode: [node({ ProgramCode: false })] }), menu({ MenuNode: [node({ StartMethod: [] })] }), menu({ MenuNode: [omit(node(), 'Memo')] }), menu({ MenuNode: [node({ Icon: null })] }), menu({ MenuNode: [{ ...node(), Unknown: true }] }),
  ])('rejects malformed or unknown MenuNode metadata %o', (invalid) => expectInfrastructureError(response([invalid])));

  it.each(operations.flatMap(([field]) => ['y', 'n', 'YES', 'NO', true, false, 1, 0, '', null, undefined, ' Y ', 'unexpected'].map((value) => [field, value] as const)))('rejects non-exact MenuPermission operation value %s=%o', (field, value) => expectInfrastructureError(response([menu({ MenuPermission: permission({ [field]: value }) })])));

  it('does not expose raw provider values through errors', () => {
    const raw = response([menu({ MenuID: 'raw-menu-id', UUID: 'raw-uuid', MenuPermission: permission({ Update: 'not-Y-or-N' }) })]);
    expect(() => validator().validate(raw)).toThrow(ManagedExchangeInfrastructureError);
    try { validator().validate(raw); } catch (error) { expect(String(error)).not.toMatch(/raw-menu-id|raw-uuid|not-Y-or-N/); }
  });

  it('is a pure reducer with no credential, claim, transport, or permission-source authority', () => {
    const source = readFileSync(resolve(__dirname, '../../src/managed-identity-exchange/providers/idx-menu-detail.validator.ts'), 'utf8');
    expect(source).not.toMatch(/nativeCredential|Authorization|RefreshToken|decodeJwt|ES512|JWKS|CustomerScope|IntegrationBinding|ManagedTokenIssuer|PermissionSource|fetch\(|https?\.request/i);
  });
});

function validator(): Validator { const target = require('../../src/managed-identity-exchange/providers/idx-menu-detail.validator') as { IdxMenuDetailValidator: new () => Validator }; return new target.IdxMenuDetailValidator(); }
function expectInfrastructureError(value: unknown): void { expect(() => validator().validate(value)).toThrow(ManagedExchangeInfrastructureError); }
function response(Data: unknown) { return { Code: 200, ExecutionTime: '12ms', Message: '', Version: '1.0.0', Data }; }
function menu(overrides: Record<string, unknown> = {}) { return { UUID: 'menu-uuid', MenuID: 'ORDERS', Category: 'Orders', Patrilineal: null, Sorting: '120', Memo: 'menu-memo', MenuNode: [node()], MenuPermission: permission(), ...overrides }; }
function permission(overrides: Record<string, unknown> = {}) { return { UUID: 'permission-uuid', UUID_Menu: 'menu-uuid', Insert: 'N', Update: 'N', Delete: 'N', Print: 'N', Import: 'N', Export: 'N', Copy: 'N', Approval: 'N', Others: null, Memo: 'permission-memo', ...overrides }; }
function node(overrides: Record<string, unknown> = {}) { return { UUID: 'node-uuid', UUID_Menu: 'menu-uuid', Language: 'language-uuid', MenuName: 'Orders', Icon: 'assignment', ProgramCode: null, ProgramPath: '/orders', StartMethod: null, Memo: 'Orders', ...overrides }; }
function omit(value: Record<string, unknown>, key: string): Record<string, unknown> { return Object.fromEntries(Object.entries(value).filter(([candidate]) => candidate !== key)); }
