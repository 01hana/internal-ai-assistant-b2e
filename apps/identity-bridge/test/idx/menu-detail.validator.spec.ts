import { IdxMenuDetailValidator } from '../../src/idx/menu-detail.validator';
import { menu, node, permission, response } from '../fixtures/idx-semantic.vectors';
describe('Bridge IDX MenuDetail validator', () => {
  it('accepts the current Feature 006 production shape and reduces metadata', () => {
    const result = new IdxMenuDetailValidator().validate(response([menu({ MenuPermission: permission({ Insert: 'Y', Export: 'Y' }) })]));
    expect(result).toEqual([{ menuId: 'ORDERS', actions: ['read', 'insert', 'export'] }]);
    expect(Object.isFrozen(result)).toBe(true); expect(Object.isFrozen(result[0])).toBe(true); expect(Object.isFrozen(result[0].actions)).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/UUID|Memo|MenuNode|Permission/i);
  });
  it.each([undefined, null, { Code: '200' }, { ...response([]), Code: 500 }, { ...response([]), Extra: true }, { ...response([]), Data: [menu({ MenuPermission: permission({ Update: 'y' }) })] }, { ...response([]), Data: [menu({ MenuNode: [{}] })] }])('fails closed for malformed registered responses', (value) => expect(() => new IdxMenuDetailValidator().validate(value)).toThrow('idx_semantic_invalid'));
  it('covers nested production metadata, multiple/duplicate menus, all-N and all-Y action contracts', () => {
    const allY = Object.fromEntries(['Insert', 'Update', 'Delete', 'Print', 'Import', 'Export', 'Copy', 'Approval'].map((key) => [key, 'Y']));
    const result = new IdxMenuDetailValidator().validate(response([menu({ Patrilineal: 'parent', MenuNode: [node({ ProgramCode: 'code', StartMethod: 'start' })], MenuPermission: permission() }), menu({ MenuID: 'ALL', MenuPermission: permission(allY) }), menu()]));
    expect(result[0].actions).toEqual(['read']); expect(result[1].actions).toEqual(['read', 'insert', 'update', 'delete', 'print', 'import', 'export', 'copy', 'approval']); expect(result).toHaveLength(3);
  });
  it.each(['Insert', 'Update', 'Delete', 'Print', 'Import', 'Export', 'Copy', 'Approval'])('rejects every non-exact %s operation value', (field) => {
    for (const value of ['y', 'n', 'YES', 'NO', true, false, 1, 0, '', null, undefined, ' Y ', 'unexpected']) expect(() => new IdxMenuDetailValidator().validate(response([menu({ MenuPermission: permission({ [field]: value }) })]))).toThrow('idx_semantic_invalid');
  });
  it.each([menu({ Unknown: true }), menu({ MenuPermission: { ...permission(), Unknown: true } }), menu({ MenuNode: [{ UUID: 'x' }] }), menu({ MenuPermission: permission({ Others: 'x' }) })])('rejects unknown or incomplete registered nested fields', (record) => expect(() => new IdxMenuDetailValidator().validate(response([record]))).toThrow('idx_semantic_invalid'));
});
