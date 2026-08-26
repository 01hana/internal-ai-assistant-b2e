import { ManagedExchangeInfrastructureError } from '../domain/managed-exchange.domain';

const MENU_ACTIONS = [
  ['Insert', 'insert'], ['Update', 'update'], ['Delete', 'delete'], ['Print', 'print'],
  ['Import', 'import'], ['Export', 'export'], ['Copy', 'copy'], ['Approval', 'approval'],
] as const;
const RESPONSE_KEYS = ['Code', 'ExecutionTime', 'Message', 'Version', 'Data'] as const;
const RECORD_KEYS = ['UUID', 'MenuID', 'Category', 'Patrilineal', 'Sorting', 'Memo', 'MenuNode', 'MenuPermission'] as const;
const PERMISSION_KEYS = ['UUID', 'UUID_Menu', ...MENU_ACTIONS.map(([field]) => field), 'Others', 'Memo'] as const;
const NODE_KEYS = ['UUID', 'UUID_Menu', 'Language', 'MenuName', 'Icon', 'ProgramCode', 'ProgramPath', 'StartMethod', 'Memo'] as const;

export type IdxMenuAction = 'read' | (typeof MENU_ACTIONS)[number][1];
export type IdxMenuDetailPermission = Readonly<{ menuId: string; actions: readonly IdxMenuAction[] }>;

/** Reduces the registered IDX MenuDetail response to non-authoritative menu semantics. */
export class IdxMenuDetailValidator {
  validate(body: unknown): readonly IdxMenuDetailPermission[] {
    if (!hasExactKeys(body, RESPONSE_KEYS) || body.Code !== 200 || !isString(body.ExecutionTime) || !isString(body.Message) || !isString(body.Version) || !Array.isArray(body.Data)) throw unavailable();
    return Object.freeze(body.Data.map((record) => this.validateRecord(record)));
  }

  private validateRecord(record: unknown): IdxMenuDetailPermission {
    if (!hasExactKeys(record, RECORD_KEYS) || !isString(record.UUID) || !isString(record.Category) || !isNullableString(record.Patrilineal) || !isString(record.Sorting) || !isString(record.Memo) || !Array.isArray(record.MenuNode)) throw unavailable();
    for (const node of record.MenuNode) validateNode(node);
    return Object.freeze({ menuId: safeMenuId(record.MenuID), actions: Object.freeze(validatePermission(record.MenuPermission)) });
  }
}

function validateNode(value: unknown): void {
  if (!hasExactKeys(value, NODE_KEYS) || !isString(value.UUID) || !isString(value.UUID_Menu) || !isString(value.Language) || !isString(value.MenuName) || !isString(value.Icon) || !isNullableString(value.ProgramCode) || !isString(value.ProgramPath) || !isNullableString(value.StartMethod) || !isString(value.Memo)) throw unavailable();
}

function validatePermission(value: unknown): IdxMenuAction[] {
  if (!hasExactKeys(value, PERMISSION_KEYS) || !isString(value.UUID) || !isString(value.UUID_Menu) || value.Others !== null || !isString(value.Memo)) throw unavailable();
  const actions: IdxMenuAction[] = ['read'];
  for (const [field, action] of MENU_ACTIONS) {
    const enabled = value[field];
    if (enabled !== 'Y' && enabled !== 'N') throw unavailable();
    if (enabled === 'Y') actions.push(action);
  }
  return actions;
}

function hasExactKeys(value: unknown, expectedKeys: readonly string[]): value is Record<string, unknown> {
  if (!isPlainRecord(value)) return false;
  const keys = Object.keys(value);
  return keys.length === expectedKeys.length && keys.every((key) => expectedKeys.includes(key));
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function isString(value: unknown): value is string { return typeof value === 'string'; }
function isNullableString(value: unknown): value is string | null { return value === null || isString(value); }

function safeMenuId(value: unknown): string {
  if (!isString(value)) throw unavailable();
  const menuId = value.trim();
  if (!menuId || /[\u0000-\u001F\u007F]/.test(menuId)) throw unavailable();
  return menuId;
}

function unavailable(): ManagedExchangeInfrastructureError { return new ManagedExchangeInfrastructureError(); }
