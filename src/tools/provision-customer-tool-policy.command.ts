import type { CustomerToolPolicy } from '../generated/prisma/client';

const INPUT_KEYS = new Set([
  'customerId',
  'toolKey',
  'version',
  'enabled',
  'requiredRoles',
  'requiredPermissionScopes'
]);
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const CONTRACT_VERSION = /^[0-9]+\.[0-9]+\.[0-9]+$/;

export type ProvisionCustomerToolPolicyInput = Readonly<{
  customerId: string;
  toolKey: string;
  version: string;
  enabled: boolean;
  requiredRoles: readonly string[];
  requiredPermissionScopes: readonly string[];
}>;

export type ProvisionCustomerToolPolicyResult = Readonly<{
  customerId: string;
  toolKey: string;
  version: string;
  enabled: boolean;
  requiredRoles: readonly string[];
  requiredPermissionScopes: readonly string[];
  changed: boolean;
}>;

export interface CustomerToolPolicyProvisioningTransaction {
  customer: {
    findUnique(input: { where: { id: string }; select: { id: true } }): Promise<{ id: string } | null>;
  };
  toolDefinition: {
    findUnique(input: {
      where: { name_version: { name: string; version: string } };
      select: { id: true; name: true; version: true; isActive: true };
    }): Promise<{ id: string; name: string; version: string; isActive: boolean } | null>;
  };
  customerToolPolicy: {
    findUnique(input: {
      where: { customerId_toolDefinitionId: { customerId: string; toolDefinitionId: string } };
    }): Promise<CustomerToolPolicy | null>;
    create(input: {
      data: Pick<CustomerToolPolicy, 'customerId' | 'toolDefinitionId' | 'enabled' | 'requiredRoles' | 'requiredPermissionScopes'>;
    }): Promise<CustomerToolPolicy>;
    update(input: {
      where: { customerId_toolDefinitionId: { customerId: string; toolDefinitionId: string } };
      data: Pick<CustomerToolPolicy, 'enabled' | 'requiredRoles' | 'requiredPermissionScopes'>;
    }): Promise<CustomerToolPolicy>;
  };
}

export interface CustomerToolPolicyProvisioningDatabase {
  $transaction<T>(work: (transaction: CustomerToolPolicyProvisioningTransaction) => Promise<T>): Promise<T>;
}

/** Internal/operator-only command. It is deliberately not registered in a Nest module or controller. */
export class ProvisionCustomerToolPolicyCommand {
  constructor(private readonly database: CustomerToolPolicyProvisioningDatabase) {}

  async execute(input: unknown): Promise<ProvisionCustomerToolPolicyResult> {
    const normalized = normalizeInput(input);
    try {
      return await this.database.$transaction(async (transaction) => {
        const customer = await transaction.customer.findUnique({
          where: { id: normalized.customerId },
          select: { id: true }
        });
        if (!customer) deny();

        const tool = await transaction.toolDefinition.findUnique({
          where: { name_version: { name: normalized.toolKey, version: normalized.version } },
          select: { id: true, name: true, version: true, isActive: true }
        });
        if (!tool?.isActive) deny();

        const where = {
          customerId_toolDefinitionId: {
            customerId: normalized.customerId,
            toolDefinitionId: tool.id
          }
        };
        const existing = await transaction.customerToolPolicy.findUnique({ where });
        if (existing && samePolicy(existing, normalized)) return result(normalized, false);

        const data = {
          enabled: normalized.enabled,
          requiredRoles: [...normalized.requiredRoles],
          requiredPermissionScopes: [...normalized.requiredPermissionScopes]
        };
        if (existing) {
          await transaction.customerToolPolicy.update({ where, data });
        } else {
          await transaction.customerToolPolicy.create({
            data: { customerId: normalized.customerId, toolDefinitionId: tool.id, ...data }
          });
        }
        return result(normalized, true);
      });
    } catch {
      throw new ProvisionCustomerToolPolicyError();
    }
  }
}

export class ProvisionCustomerToolPolicyError extends Error {
  constructor() {
    super('Customer tool policy provisioning cannot be completed.');
  }
}

function normalizeInput(input: unknown): ProvisionCustomerToolPolicyInput {
  if (!isRecord(input) || !hasExactKeys(input) || typeof input.enabled !== 'boolean') deny();
  const customerId = identifier(input.customerId);
  const toolKey = identifier(input.toolKey);
  const version = typeof input.version === 'string' && CONTRACT_VERSION.test(input.version) ? input.version : deny();
  const requiredRoles = normalizeStringArray(input.requiredRoles);
  const requiredPermissionScopes = normalizeStringArray(input.requiredPermissionScopes);
  return Object.freeze({ customerId, toolKey, version, enabled: input.enabled, requiredRoles, requiredPermissionScopes });
}

function normalizeStringArray(input: unknown): readonly string[] {
  if (!Array.isArray(input)) deny();
  const values = input.map((value) => {
    if (typeof value !== 'string') deny();
    const normalized = value.trim();
    if (!normalized || normalized.length > 128 || hasControlCharacter(normalized)) deny();
    return normalized;
  });
  return Object.freeze([...new Set(values)].sort());
}

function identifier(value: unknown): string {
  if (typeof value !== 'string' || !IDENTIFIER.test(value) || value.includes('*')) deny();
  return value;
}

function samePolicy(policy: CustomerToolPolicy, input: ProvisionCustomerToolPolicyInput): boolean {
  return policy.enabled === input.enabled
    && equal(policy.requiredRoles, input.requiredRoles)
    && equal(policy.requiredPermissionScopes, input.requiredPermissionScopes);
}

function equal(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function result(input: ProvisionCustomerToolPolicyInput, changed: boolean): ProvisionCustomerToolPolicyResult {
  return Object.freeze({ ...input, changed });
}

function hasExactKeys(value: Record<string, unknown>): boolean {
  const keys = Object.keys(value);
  return keys.length === INPUT_KEYS.size && keys.every((key) => INPUT_KEYS.has(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 31 || code === 127;
  });
}

function deny(): never {
  throw new ProvisionCustomerToolPolicyError();
}
