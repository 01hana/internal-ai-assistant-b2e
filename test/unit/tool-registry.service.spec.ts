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
        timeoutMs: 3000,
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

  it('resolves only the exact active read-only key and version without latest-version fallback', async () => {
    const service = new ToolRegistryService(
      createPrismaServiceMock([
        toolDefinition({ name: 'inventory.stock-on-hand', version: '1.0.0' }),
        toolDefinition({ name: 'inventory.stock-on-hand', version: '2.0.0' })
      ]),
      customerToolPolicyMock()
    );

    await expect(service.resolveExactExecutableTool('inventory.stock-on-hand', '1.0.0')).resolves.toEqual({
      tool: expect.objectContaining({ key: 'inventory.stock-on-hand', version: '1.0.0' })
    });
    await expect(service.resolveExactExecutableTool('inventory.stock-on-hand', '3.0.0')).resolves.toEqual({
      deniedReason: 'tool_not_registered'
    });
  });

  it('lists only active read-only no-side-effect tools allowed by the exact Customer policy', async () => {
    const tools = [
      toolDefinition({ id: 'allowed', name: 'allowed.read' }),
      toolDefinition({ id: 'denied', name: 'denied.read' }),
      toolDefinition({ id: 'inactive', name: 'inactive.read', isActive: false }),
      toolDefinition({ id: 'write', name: 'write.tool', operation: ToolOperation.update, hasSideEffect: true } as never)
    ];
    const policy = { resolve: jest.fn(async ({ toolDefinitionId }: { toolDefinitionId: string }) => ({ allowed: toolDefinitionId === 'allowed', policy: {} })) };
    const service = new ToolRegistryService(createPrismaServiceMock(tools), policy as never);

    await expect(service.listDiscoverableToolsForCustomer({ customerId: 'customer-a' } as never)).resolves.toEqual([
      expect.objectContaining({ id: 'allowed', key: 'allowed.read' })
    ]);
    expect(policy.resolve).toHaveBeenCalledTimes(2);
  });

  it('separates enabled and explicitly disabled same-Customer discovery entries while omitting absent policies', async () => {
    const tools = [
      toolDefinition({ id: 'allowed', name: 'allowed.read' }),
      toolDefinition({ id: 'denied', name: 'denied.read' }),
      toolDefinition({ id: 'absent', name: 'absent.read' }),
      toolDefinition({ id: 'inactive', name: 'inactive.read', isActive: false }),
      toolDefinition({ id: 'write', name: 'write.tool', operation: ToolOperation.update, hasSideEffect: true } as never)
    ];
    const service = new ToolRegistryService(
      createPrismaServiceMock(tools, [
        { customerId: 'customer-a', toolDefinitionId: 'allowed', enabled: true },
        { customerId: 'customer-a', toolDefinitionId: 'denied', enabled: false },
        { customerId: 'customer-b', toolDefinitionId: 'absent', enabled: false }
      ]),
      customerToolPolicyMock()
    );

    await expect(service.listDiscoveryCatalogForCustomer({ customerId: 'customer-a' })).resolves.toEqual({
      allowed: [expect.objectContaining({ id: 'allowed', key: 'allowed.read' })],
      explicitlyDenied: [expect.objectContaining({ id: 'denied', key: 'denied.read' })]
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

  it('derives canonical operation identity from ToolDefinition and creates a value-free safe summary', async () => {
    const service = new ToolRegistryService(createPrismaServiceMock([toolDefinition({ name: 'mock.orders.status.lookup' })]), customerToolPolicyMock());
    const tool = await service.getExecutableTool('mock.orders.status.lookup');

    expect(
      service.validateNamedOperation(tool!, {
        key: 'mock.orders.status.lookup',
        arguments: { entityId: 'SO-10001' },
        reason: 'order lookup',
        operation: 'mock.orders.cancel'
      })
    ).toEqual({
      valid: true,
      operation: {
        canonicalToolKey: 'mock.orders.status.lookup',
        schemaVersion: '1.0.0',
        arguments: { entityId: 'SO-10001' }
      },
      safeInputSummary: {
        canonicalToolKey: 'mock.orders.status.lookup',
        schemaVersion: '1.0.0',
        argumentKeys: ['entityId'],
        argumentCount: 1
      }
    });
  });

  it.each([
    ['missing arguments', undefined],
    ['missing required input', {}],
    ['unknown property', { entityId: 'SO-10001', unknownField: 'value' }],
    ['type mismatch', { entityId: 10001 }],
    ['SQL-like value', { entityId: 'SELECT * FROM secrets' }],
    ['URL value', { entityId: 'https://evil.test/private' }],
    ['HTTP path value', { entityId: '/admin/private' }],
    ['query-string value', { entityId: '?token=secret' }],
    ['shell command value', { entityId: 'curl https://evil.test' }],
    ['native credential key', { entityId: 'SO-10001', password: 'secret' }],
    ['connector reference key', { entityId: 'SO-10001', connectorContextRef: 'ccr_secret' }],
    ['adapter selector key', { entityId: 'SO-10001', adapterKey: 'evil' }],
    ['string limit', { entityId: 'x'.repeat(513) }],
    ['key limit', Object.fromEntries(Array.from({ length: 33 }, (_, index) => [`field${index}`, index]))],
    ['depth limit', { entityId: 'SO-10001', nested: { a: { b: { c: { d: true } } } } }],
    ['array limit', { entityId: 'SO-10001', items: Array.from({ length: 101 }, (_, index) => index) }]
  ])('rejects %s before execution', async (_scenario, argumentsValue) => {
    const service = new ToolRegistryService(createPrismaServiceMock([toolDefinition({ name: 'mock.orders.status.lookup' })]), customerToolPolicyMock());
    const tool = await service.getExecutableTool('mock.orders.status.lookup');

    expect(
      service.validateNamedOperation(tool!, {
        key: tool!.key,
        arguments: argumentsValue,
        reason: 'test'
      })
    ).toEqual(
      expect.objectContaining({
        valid: false,
        deniedReason: 'schema_invalid'
      })
    );
  });

  it('validates bounded nested arrays and scalar schema types recursively', async () => {
    const service = new ToolRegistryService(createPrismaServiceMock([]), customerToolPolicyMock());
    const tool = {
      ...(await new ToolRegistryService(
        createPrismaServiceMock([toolDefinition({ name: 'mock.orders.status.lookup' })]),
        customerToolPolicyMock()
      ).getExecutableTool('mock.orders.status.lookup'))!,
      inputSchema: {
        type: 'object',
        required: ['filters'],
        properties: {
          filters: {
            type: 'array',
            minItems: 1,
            maxItems: 2,
            items: {
              type: 'object',
              required: ['field', 'value'],
              properties: {
                field: { type: 'string', enum: ['status'] },
                value: { type: 'string', minLength: 1, maxLength: 32 }
              }
            }
          },
          includeClosed: { type: 'boolean' },
          minimumAmount: { type: 'number', minimum: 0, maximum: 1000000 }
        }
      }
    };

    expect(
      service.validateNamedOperation(tool, {
        key: tool.key,
        arguments: {
          filters: [{ field: 'status', value: 'open' }],
          includeClosed: false,
          minimumAmount: 0
        },
        reason: 'test'
      })
    ).toEqual(expect.objectContaining({ valid: true }));
  });

  it('parses and freezes a versioned result policy only from ToolDefinition.outputSchema', async () => {
    const service = new ToolRegistryService(
      createPrismaServiceMock([
        toolDefinition({
          outputSchema: outputSchemaWithPolicy()
        })
      ]),
      customerToolPolicyMock()
    );
    const tool = await service.getExecutableTool('mock.inventory.availability.lookup');

    const result = service.resolveResultPolicy(tool!);

    expect(result).toEqual({
      allowed: true,
      policy: validResultPolicy()
    });
    if (result.allowed) {
      expect(Object.isFrozen(result.policy)).toBe(true);
      expect(Object.isFrozen(result.policy.allowedFieldPaths)).toBe(true);
      expect(Object.isFrozen(result.policy.limits)).toBe(true);
    }
  });

  it.each([
    ['missing extension', { type: 'object', required: [], properties: { itemSku: { type: 'string' } } }, 'missing_result_policy'],
    ['non-object extension', { ...outputSchemaWithPolicy(), 'x-assistant-result-policy': 'allow-all' }, 'invalid_result_policy'],
    ['unsupported version', outputSchemaWithPolicy({ version: '2' }), 'unsupported_result_policy_version'],
    ['duplicate allowed paths', outputSchemaWithPolicy({ allowedFieldPaths: ['itemSku', 'itemSku'] }), 'invalid_result_policy'],
    ['unsafe path', outputSchemaWithPolicy({ allowedFieldPaths: ['itemSku', '__proto__.secret'] }), 'invalid_result_policy'],
    ['undeclared allowed path', outputSchemaWithPolicy({ allowedFieldPaths: ['itemSku', 'secretField'] }), 'invalid_result_policy'],
    ['provenance outside allowed paths', outputSchemaWithPolicy({ evidenceSafeProvenanceFields: ['warehouseCode'] }), 'invalid_result_policy'],
    [
      'mask outside declared properties',
      outputSchemaWithPolicy({
        permissionMasks: [{ fieldPath: 'secretField', requiredPermissionScopes: ['inventory:read'], action: 'omit' }]
      }),
      'invalid_result_policy'
    ],
    ['invalid limits', outputSchemaWithPolicy({ limits: { maxDepth: 0, maxItems: 100, maxStringLength: 512, maxTotalBytes: 16384 } }), 'invalid_result_policy']
  ])('defaults to deny for %s', async (_scenario, outputSchema, reason) => {
    const service = new ToolRegistryService(
      createPrismaServiceMock([toolDefinition({ outputSchema })]),
      customerToolPolicyMock()
    );
    const tool = await service.getExecutableTool('mock.inventory.availability.lookup');

    expect(service.resolveResultPolicy(tool!)).toEqual({ allowed: false, reason });
  });
});

function validResultPolicy() {
  return {
    version: '1' as const,
    allowedFieldPaths: ['itemSku', 'availableQuantity'],
    deniedFieldPaths: ['organizationId'],
    permissionMasks: [],
    limits: {
      maxDepth: 4,
      maxItems: 100,
      maxStringLength: 512,
      maxTotalBytes: 16384
    },
    evidenceSafeProvenanceFields: ['itemSku']
  };
}

function outputSchemaWithPolicy(overrides: Record<string, unknown> = {}) {
  return {
    type: 'object',
    required: ['itemSku', 'availableQuantity'],
    properties: {
      itemSku: { type: 'string' },
      availableQuantity: { type: 'number' },
      organizationId: { type: 'string' }
    },
    'x-assistant-result-policy': {
      ...validResultPolicy(),
      ...overrides
    }
  };
}

function createPrismaServiceMock(
  tools: ReturnType<typeof toolDefinition>[],
  policies: Array<{ customerId: string; toolDefinitionId: string; enabled: boolean }> = []
) {
  return {
    db: {
      toolDefinition: {
        findMany: jest.fn(async () => tools),
        findFirst: jest.fn(async ({ where }: { where: { name: string } }) => tools.find((tool) => tool.name === where.name) ?? null),
        findUnique: jest.fn(async ({ where }: { where: { name_version: { name: string; version: string } } }) =>
          tools.find((tool) => tool.name === where.name_version.name && tool.version === where.name_version.version) ?? null
        )
      },
      customerToolPolicy: {
        findUnique: jest.fn(async ({ where }: { where: { customerId_toolDefinitionId: { customerId: string; toolDefinitionId: string } } }) => {
          const selector = where.customerId_toolDefinitionId;
          return policies.find((policy) =>
            policy.customerId === selector.customerId && policy.toolDefinitionId === selector.toolDefinitionId
          ) ?? null;
        })
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
