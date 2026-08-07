import { ToolRegistryService } from '../../src/tools/tool-registry.service';
import { CustomerToolPolicyService } from '../../src/tools/customer-tool-policy.service';
import { RiskLevel, ToolOperation } from '../../src/generated/prisma/enums';

describe('ToolRegistryService', () => {
  it('loads active registered read tools from Prisma ToolDefinition records', async () => {
    const service = new ToolRegistryService(createPrismaServiceMock([toolDefinition({ name: 'mock.inventory.availability.lookup' })]), customerToolPolicyMock());

    await expect(service.getExecutableTool('mock.inventory.availability.lookup')).resolves.toEqual(
      expect.objectContaining({
        key: 'mock.inventory.availability.lookup',
        name: 'mock.inventory.availability.lookup',
        version: '1.0.0',
        connectorKey: 'mock',
        requiredPermissionScopes: ['inventory:read']
      })
    );
  });

  it('resolves unknown and inactive tools as fail-closed decisions', async () => {
    const service = new ToolRegistryService(
      createPrismaServiceMock([
        toolDefinition({
          name: 'mock.inventory.availability.lookup',
          isActive: false
        })
      ]),
      customerToolPolicyMock()
    );

    await expect(service.resolveExecutableTool('mock.unknown.lookup')).resolves.toEqual({
      deniedReason: 'tool_not_registered'
    });
    await expect(service.resolveExecutableTool('mock.inventory.availability.lookup')).resolves.toEqual({
      deniedReason: 'tool_inactive'
    });
  });

  it('normalizes DB records without consulting connector listTools capability reports', async () => {
    const service = new ToolRegistryService(createPrismaServiceMock([toolDefinition({ name: 'mock.orders.status.lookup' })]), customerToolPolicyMock());

    await expect(service.listTools()).resolves.toEqual([
      expect.objectContaining({
        key: 'mock.orders.status.lookup',
        operation: ToolOperation.read,
        riskLevel: RiskLevel.low,
        active: true,
        inputSchema: expect.objectContaining({
          required: ['entityId']
        })
      })
    ]);
  });

  it('returns schema_invalid with a stable schema error reason when required input is missing', async () => {
    const service = new ToolRegistryService(createPrismaServiceMock([toolDefinition({ name: 'mock.orders.status.lookup' })]), customerToolPolicyMock());
    const tool = await service.getExecutableTool('mock.orders.status.lookup');

    expect(tool).toBeDefined();
    expect(service.validateInput(tool!, {})).toEqual({
      valid: false,
      deniedReason: 'schema_invalid',
      schemaErrorReason: 'missing_required_entityId'
    });
    expect(service.validateInput(tool!, { entityId: 'SO-10001' })).toEqual({ valid: true });
  });
});

function createPrismaServiceMock(tools: ReturnType<typeof toolDefinition>[]) {
  return {
    db: {
      toolDefinition: {
        findMany: jest.fn(async () => tools),
        findFirst: jest.fn(async ({ where }: { where: { name: string } }) => tools.find((tool) => tool.name === where.name) ?? null)
      }
    }
  } as never;
}

function customerToolPolicyMock() {
  return {
    resolve: jest.fn()
  } as unknown as CustomerToolPolicyService;
}

function toolDefinition(overrides: Partial<ReturnType<typeof toolDefinitionShape>>) {
  return {
    ...toolDefinitionShape(),
    ...overrides
  };
}

function toolDefinitionShape() {
  return {
    id: 'tool-definition-001',
    name: 'mock.inventory.availability.lookup',
    version: '1.0.0',
    description: 'Lookup mock inventory availability.',
    resource: 'inventory',
    operation: ToolOperation.read,
    inputSchema: {
      type: 'object',
      required: ['entityId'],
      properties: {
        entityId: { type: 'string' }
      }
    },
    outputSchema: {
      type: 'object',
      required: ['itemSku', 'availableQuantity']
    },
    requiredPermissions: ['inventory:read'],
    riskLevel: RiskLevel.low,
    hasSideEffect: false,
    requiresConfirmation: false,
    requiresApproval: false,
    connectorKey: 'mock',
    timeoutMs: 3000,
    auditBehavior: null,
    isActive: true,
    createdAt: new Date('2026-06-16T00:00:00.000Z'),
    updatedAt: new Date('2026-06-16T00:00:00.000Z')
  };
}
