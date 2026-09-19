import type { CustomerToolPolicy } from '../../src/generated/prisma/client';
import {
  ProvisionCustomerToolPolicyCommand,
  ProvisionCustomerToolPolicyError,
  type CustomerToolPolicyProvisioningTransaction
} from '../../src/tools/provision-customer-tool-policy.command';
import { parseProvisionCustomerToolPolicyArguments } from '../../scripts/provision-customer-tool-policy';

const BASE_INPUT = Object.freeze({
  customerId: 'customer-a',
  toolKey: 'work-orders.monthly-new-count',
  version: '1.0.0',
  enabled: true,
  requiredRoles: [] as string[],
  requiredPermissionScopes: [] as string[]
});

describe('operator-controlled CustomerToolPolicy provisioning', () => {
  it('creates an exact Customer + exact active ToolDefinition policy and replays idempotently', async () => {
    const harness = createHarness();
    await expect(harness.command.execute(BASE_INPUT)).resolves.toEqual({ ...BASE_INPUT, changed: true });
    await expect(harness.command.execute(BASE_INPUT)).resolves.toEqual({ ...BASE_INPUT, changed: false });
    expect(harness.policies).toHaveLength(1);
    expect(harness.create).toHaveBeenCalledTimes(1);
    expect(harness.update).not.toHaveBeenCalled();
  });

  it.each([
    ['unknown Customer', { customerId: 'customer-unknown' }],
    ['unknown exact ToolDefinition', { version: '9.9.9' }]
  ])('fails closed for an %s', async (_label, override) => {
    const harness = createHarness();
    await expect(harness.command.execute({ ...BASE_INPUT, ...override })).rejects.toBeInstanceOf(ProvisionCustomerToolPolicyError);
    expect(harness.policies).toHaveLength(0);
  });

  it('fails closed for an inactive exact ToolDefinition', async () => {
    const harness = createHarness({ toolActive: false });
    await expect(harness.command.execute(BASE_INPUT)).rejects.toBeInstanceOf(ProvisionCustomerToolPolicyError);
    expect(harness.policies).toHaveLength(0);
  });

  it('normalizes roles/scopes and updates only the selected Customer policy', async () => {
    const harness = createHarness({ customers: ['customer-a', 'customer-b'] });
    await harness.command.execute({
      ...BASE_INPUT,
      customerId: 'customer-b',
      requiredRoles: [' operator ', 'admin', 'operator'],
      requiredPermissionScopes: ['work-orders:read', ' menu:ORDERS:read ', 'work-orders:read']
    });
    expect(harness.policies).toEqual([
      expect.objectContaining({
        customerId: 'customer-b',
        requiredRoles: ['admin', 'operator'],
        requiredPermissionScopes: ['menu:ORDERS:read', 'work-orders:read']
      })
    ]);
    expect(harness.policies).not.toContainEqual(expect.objectContaining({ customerId: 'customer-a' }));
  });

  it.each([
    ['endpoint', 'https://customer.example.test'],
    ['url', 'https://customer.example.test'],
    ['path', '/v1/query'],
    ['method', 'GET'],
    ['sql', 'select 1'],
    ['connectorContextRef', 'opaque'],
    ['credential', 'secret'],
    ['token', 'secret'],
    ['secret', 'secret'],
    ['adapterKey', 'adapter'],
    ['connectorInstanceId', 'instance']
  ])('rejects prohibited provisioning field %s', async (field, value) => {
    const harness = createHarness();
    await expect(harness.command.execute({ ...BASE_INPUT, [field]: value })).rejects.toBeInstanceOf(ProvisionCustomerToolPolicyError);
    expect(harness.policies).toHaveLength(0);
  });

  it('rejects duplicate or conflicting scalar CLI input and unknown connector flags', () => {
    expect(() => parseProvisionCustomerToolPolicyArguments([
      '--customer', 'customer-a', '--customer', 'customer-b',
      '--tool', BASE_INPUT.toolKey, '--version', BASE_INPUT.version, '--enabled', 'true'
    ])).toThrow('Usage:');
    expect(() => parseProvisionCustomerToolPolicyArguments([
      '--customer', 'customer-a', '--tool', BASE_INPUT.toolKey,
      '--version', BASE_INPUT.version, '--enabled', 'true', '--endpoint', 'https://example.test'
    ])).toThrow('Usage:');
  });

  it('keeps the command direct-only with no controller/module decorators', () => {
    const source = require('node:fs').readFileSync(require('node:path').resolve('src/tools/provision-customer-tool-policy.command.ts'), 'utf8');
    expect(source).not.toMatch(/@(Controller|Module|Get|Post|Put|Patch|Delete)\b/);
  });
});

function createHarness(options: { customers?: string[]; toolActive?: boolean } = {}) {
  const customers = new Set(options.customers ?? ['customer-a']);
  const tool = { id: 'tool-monthly', name: BASE_INPUT.toolKey, version: BASE_INPUT.version, isActive: options.toolActive ?? true };
  const policies: CustomerToolPolicy[] = [];
  const create = jest.fn(async ({ data }: { data: Omit<CustomerToolPolicy, 'createdAt' | 'updatedAt'> }) => {
    const policy = { ...data, createdAt: new Date(0), updatedAt: new Date(0) } as CustomerToolPolicy;
    policies.push(policy);
    return policy;
  });
  const update = jest.fn(async ({ where, data }: {
    where: { customerId_toolDefinitionId: { customerId: string; toolDefinitionId: string } };
    data: Pick<CustomerToolPolicy, 'enabled' | 'requiredRoles' | 'requiredPermissionScopes'>;
  }) => {
    const key = where.customerId_toolDefinitionId;
    const policy = policies.find((candidate) => candidate.customerId === key.customerId && candidate.toolDefinitionId === key.toolDefinitionId)!;
    Object.assign(policy, data);
    return policy;
  });
  const transaction: CustomerToolPolicyProvisioningTransaction = {
    customer: {
      findUnique: jest.fn(async ({ where }) => customers.has(where.id) ? { id: where.id } : null)
    },
    toolDefinition: {
      findUnique: jest.fn(async ({ where }) => {
        const exact = where.name_version;
        return exact.name === tool.name && exact.version === tool.version ? tool : null;
      })
    },
    customerToolPolicy: {
      findUnique: jest.fn(async ({ where }) => {
        const key = where.customerId_toolDefinitionId;
        return policies.find((candidate) => candidate.customerId === key.customerId && candidate.toolDefinitionId === key.toolDefinitionId) ?? null;
      }),
      create,
      update
    }
  };
  return {
    policies,
    create,
    update,
    command: new ProvisionCustomerToolPolicyCommand({ $transaction: async (work) => work(transaction) })
  };
}
