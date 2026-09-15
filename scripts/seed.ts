import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma/client';
import { RiskLevel, ToolOperation } from '../src/generated/prisma/enums';
import { createPrismaClient } from '../src/prisma/prisma-client.factory';
import { seedUs1TestFixtures } from './us1-test-fixtures';
import { GATEWAY_INTEGRATION_BINDING_SEEDS } from './gateway-identity-fixtures';

const FIXTURE_TIME = new Date('2026-08-04T00:00:00.000Z');
const CUSTOMER_A_ID = 'customer-a';
const CUSTOMER_B_ID = 'customer-b';

export async function seedCoreData(prisma: PrismaClient) {
  await seedCustomers(prisma);
  await seedGatewayIntegrationBindings(prisma);
  const toolDefinitions = await seedToolDefinitions(prisma);
  await seedCustomerToolPolicies(prisma, toolDefinitions);
  await seedKnowledgeDocuments(prisma);
}

async function seedGatewayIntegrationBindings(prisma: PrismaClient) {
  for (const binding of GATEWAY_INTEGRATION_BINDING_SEEDS) {
    const existing = await prisma.integrationBinding.findUnique({ where: { integrationId: binding.integrationId } });
    if (existing && (existing.customerId !== binding.customerId || existing.allowedHostApp !== binding.allowedHostApp)) {
      throw new Error('Seed IntegrationBinding mapping conflicts with an existing explicit binding.');
    }
    if (existing) {
      await prisma.integrationBinding.update({ where: { integrationId: binding.integrationId }, data: { enabled: binding.enabled } });
    } else {
      await prisma.integrationBinding.create({ data: binding });
    }
  }
}

async function seedCustomers(prisma: PrismaClient) {
  for (const id of [CUSTOMER_A_ID, CUSTOMER_B_ID]) {
    await prisma.customer.upsert({ where: { id }, update: {}, create: { id } });
  }
}

async function seedKnowledgeDocuments(prisma: PrismaClient) {
  for (const document of KNOWLEDGE_DOCUMENT_FIXTURES) {
    const { chunks, ...documentData } = document;
    const knowledgeDocument = await prisma.knowledgeDocument.upsert({
      where: {
        customerId_sourceKey_version: {
          customerId: documentData.customerId,
          sourceKey: documentData.sourceKey,
          version: documentData.version
        }
      },
      update: documentData,
      create: documentData
    });

    for (const chunk of chunks) {
      await prisma.knowledgeChunk.upsert({
        where: {
          customerId_id: {
            customerId: document.customerId,
            id: chunk.id
          }
        },
        update: {
          documentId: knowledgeDocument.id,
          chunkIndex: chunk.chunkIndex,
          heading: chunk.heading,
          content: chunk.content,
          tokenCount: chunk.tokenCount,
          metadata: {
            fixture: true,
            sourceKey: document.sourceKey
          }
        },
        create: {
          id: chunk.id,
          customerId: document.customerId,
          documentId: knowledgeDocument.id,
          chunkIndex: chunk.chunkIndex,
          heading: chunk.heading,
          content: chunk.content,
          tokenCount: chunk.tokenCount,
          metadata: {
            fixture: true,
            sourceKey: document.sourceKey
          }
        }
      });
    }
  }
}

const KNOWLEDGE_DOCUMENT_FIXTURES = [
  {
    id: 'knowledge-customer-a-sop-001',
    customerId: CUSTOMER_A_ID,
    title: 'Internal Assistant SOP',
    sourceType: 'sop' as const,
    sourceKey: 'internal-assistant-sop',
    version: '1.0.0',
    language: 'zh-TW',
    status: 'active' as const,
    visibility: 'CUSTOMER' as const,
    organizationIds: [],
    requiredPermissionScopes: [],
    metadata: { fixture: true },
    chunks: [
      {
        id: 'knowledge-chunk-customer-a-sop-001',
        chunkIndex: 0,
        heading: '權限與資料邊界',
        content: '內部後台 AI 助理必須先檢查身份、組織邊界與權限，再查詢資料或呼叫工具。',
        tokenCount: 32
      }
    ]
  },
  {
    id: 'knowledge-customer-a-return-001',
    customerId: CUSTOMER_A_ID,
    title: '退貨處理 SOP',
    sourceType: 'sop' as const,
    sourceKey: 'sop-return-process',
    version: '1.0.0',
    language: 'zh-TW',
    status: 'active' as const,
    visibility: 'CUSTOMER' as const,
    organizationIds: [],
    requiredPermissionScopes: [],
    metadata: { fixture: true, domain: 'orders' },
    chunks: [
      {
        id: 'knowledge-chunk-customer-a-return-001',
        chunkIndex: 0,
        heading: '退貨流程',
        content: '退貨流程須先確認訂單狀態與收貨紀錄，再依 SOP 建立退貨申請；未完成收貨前不得直接退款。',
        tokenCount: 43
      }
    ]
  },
  {
    id: 'knowledge-customer-a-order-status-001',
    customerId: CUSTOMER_A_ID,
    title: '訂單狀態欄位說明',
    sourceType: 'field_guide' as const,
    sourceKey: 'field-order-status',
    version: '1.0.0',
    language: 'zh-TW',
    status: 'active' as const,
    visibility: 'CUSTOMER' as const,
    organizationIds: [],
    requiredPermissionScopes: [],
    metadata: { fixture: true, domain: 'orders' },
    chunks: [
      {
        id: 'knowledge-chunk-customer-a-order-status-001',
        chunkIndex: 0,
        heading: 'status 欄位',
        content: 'status 欄位代表訂單目前處理階段，例如 draft、confirmed、shipped 或 cancelled；它不是庫存數量欄位。',
        tokenCount: 49
      }
    ]
  },
  // Deterministic rebuildable seed fixtures, not retained-data ownership inference.
  {
    id: 'knowledge-customer-a-shared-001',
    customerId: CUSTOMER_A_ID,
    title: 'Customer A shared knowledge fixture',
    sourceType: 'policy' as const,
    sourceKey: 'shared-source',
    version: '1',
    language: 'en',
    status: 'active' as const,
    visibility: 'CUSTOMER' as const,
    organizationIds: [],
    requiredPermissionScopes: [],
    metadata: { fixture: true, customerFixture: 'A' },
    chunks: [{ id: 'knowledge-chunk-customer-a-shared-001', chunkIndex: 0, heading: 'shared', content: 'Customer A shared fixture.', tokenCount: 5 }]
  },
  {
    id: 'knowledge-customer-b-shared-001',
    customerId: CUSTOMER_B_ID,
    title: 'Customer B shared knowledge fixture',
    sourceType: 'policy' as const,
    sourceKey: 'shared-source',
    version: '1',
    language: 'en',
    status: 'active' as const,
    visibility: 'ORGANIZATION' as const,
    organizationIds: ['org-shared'],
    requiredPermissionScopes: ['orders:read'],
    metadata: { fixture: true, customerFixture: 'B' },
    chunks: [{ id: 'knowledge-chunk-customer-b-shared-001', chunkIndex: 0, heading: 'shared', content: 'Customer B shared fixture.', tokenCount: 5 }]
  }
];

async function seedToolDefinitions(prisma: PrismaClient) {
  const definitions = [];
  for (const tool of [...MOCK_TOOL_DEFINITIONS, SHINMONE_REFERENCE_TOOL_DEFINITION]) {
    definitions.push(await prisma.toolDefinition.upsert({
      where: {
        name_version: {
          name: tool.name,
          version: tool.version
        }
      },
      update: {
        ...tool,
        isActive: true,
        updatedAt: FIXTURE_TIME
      },
      create: tool
    }));
  }
  return definitions;
}

async function seedCustomerToolPolicies(prisma: PrismaClient, toolDefinitions: Array<{ id: string; name: string; version: string }>) {
  const customerATools = toolDefinitions.filter((tool) => tool.name.startsWith('mock.') || tool.name === 'work-orders.monthly-new-count');
  const customerBTools = toolDefinitions.filter((tool) => tool.name === 'inventory.stock-on-hand');
  if (customerATools.length !== 7 || customerBTools.length !== 1) throw new Error('Required discovery ToolDefinitions were not seeded.');
  const obsoleteCustomerBReadTool = toolDefinitions.find((tool) => tool.name === 'mock.orders.status.lookup' && tool.version === '1.0.0');
  if (!obsoleteCustomerBReadTool) throw new Error('Required mock order status ToolDefinition was not seeded.');
  await prisma.customerToolPolicy.deleteMany({
    where: { customerId: CUSTOMER_B_ID, toolDefinitionId: obsoleteCustomerBReadTool.id }
  });
  for (const [customerId, tools] of [[CUSTOMER_A_ID, customerATools], [CUSTOMER_B_ID, customerBTools]] as const) {
    for (const lookup of tools) {
      await prisma.customerToolPolicy.upsert({
        where: { customerId_toolDefinitionId: { customerId, toolDefinitionId: lookup.id } },
        update: { enabled: true, requiredRoles: [], requiredPermissionScopes: [] },
        create: { customerId, toolDefinitionId: lookup.id, enabled: true, requiredRoles: [], requiredPermissionScopes: [] }
      });
    }
  }
}

const discoveryMetadata = (input: {
  resource: string[]; intent?: string[]; metric?: string[]; timeRange?: string[];
  required?: string[]; taskType: string; entityConcepts?: string[]; argumentName?: string;
}) => ({
  version: '1', locale: 'zh-TW', resourceConcepts: input.resource,
  intentConcepts: input.intent ?? ['read'], metricConcepts: input.metric ?? [],
  timeRangeConcepts: input.timeRange ?? [], requiredConceptGroups: input.required ?? ['resource'],
  argumentBindings: input.entityConcepts ? [{ argumentName: input.argumentName ?? 'entityId', source: 'entity_value', concepts: input.entityConcepts }] : [],
  taskType: input.taskType, requiredEvidence: ['identity_context', 'structured_record']
});

const baseInputSchema = (metadata: ReturnType<typeof discoveryMetadata>) => ({
  type: 'object',
  required: ['entityId'],
  properties: {
    entityId: { type: 'string' }
  },
  'x-assistant-discovery-v1': metadata
});

const createMockOutputSchema = (input: {
  required: string[];
  properties: Record<string, Record<string, unknown>>;
  allowedFieldPaths: string[];
  evidenceSafeProvenanceFields: string[];
  deniedFieldPaths?: string[];
}) => ({
  type: 'object',
  required: input.required,
  properties: {
    ...input.properties,
    organizationId: { type: 'string' }
  },
  'x-assistant-result-policy': {
    version: '1',
    allowedFieldPaths: input.allowedFieldPaths,
    deniedFieldPaths: [...new Set(['organizationId', ...(input.deniedFieldPaths ?? [])])],
    permissionMasks: [],
    limits: {
      maxDepth: 4,
      maxItems: 100,
      maxStringLength: 512,
      maxTotalBytes: 16384
    },
    evidenceSafeProvenanceFields: input.evidenceSafeProvenanceFields
  }
});

const MOCK_TOOL_DEFINITIONS = [
  {
    name: 'mock.orders.status.lookup',
    version: '1.0.0',
    description: 'Lookup mock order status for internal assistant development.',
    resource: 'orders',
    operation: ToolOperation.read,
    inputSchema: baseInputSchema(discoveryMetadata({ resource: ['order'], metric: ['status'], taskType: 'order_status_lookup', entityConcepts: ['orderId'] })),
    outputSchema: createMockOutputSchema({
      required: ['orderId', 'status'],
      properties: {
        orderId: { type: 'string' },
        customerCode: { type: 'string' },
        status: {
          type: ['string', 'array'],
          items: { type: 'string' },
          minItems: 1,
          maxItems: 100
        },
        requestedShipDate: { type: 'string' },
        committedShipDate: { type: 'string' },
        lineCount: { type: 'number' },
        holdReason: { type: 'string' }
      },
      allowedFieldPaths: ['orderId', 'status', 'requestedShipDate', 'committedShipDate', 'lineCount', 'holdReason'],
      deniedFieldPaths: ['customerCode'],
      evidenceSafeProvenanceFields: ['orderId']
    }),
    requiredPermissions: ['orders:read'],
    riskLevel: RiskLevel.low,
    connectorKey: 'mock',
    timeoutMs: 3000,
    auditBehavior: {
      summarizeInput: true,
      summarizeOutput: true
    },
    isActive: true
  },
  {
    name: 'mock.orders.status.update',
    version: '1.0.0',
    description: 'Mock order status update side effect for internal assistant development.',
    resource: 'orders',
    operation: ToolOperation.update,
    inputSchema: baseInputSchema(discoveryMetadata({ resource: ['order'], intent: ['update'], required: ['resource', 'intent'], taskType: 'order_status_update', entityConcepts: ['orderId'] })),
    outputSchema: createMockOutputSchema({
      required: ['orderId', 'status'],
      properties: {
        orderId: { type: 'string' },
        status: { type: 'string' },
        sideEffectApplied: { type: 'boolean' }
      },
      allowedFieldPaths: ['orderId', 'status', 'sideEffectApplied'],
      evidenceSafeProvenanceFields: ['orderId']
    }),
    requiredPermissions: ['orders:update'],
    riskLevel: RiskLevel.medium,
    hasSideEffect: true,
    requiresConfirmation: true,
    requiresApproval: false,
    connectorKey: 'mock',
    timeoutMs: 3000,
    auditBehavior: {
      summarizeInput: true,
      summarizeOutput: true
    },
    isActive: true
  },
  {
    name: 'mock.orders.cancel',
    version: '1.0.0',
    description: 'Mock order cancellation side effect for internal assistant development.',
    resource: 'orders',
    operation: ToolOperation.update,
    inputSchema: baseInputSchema(discoveryMetadata({ resource: ['order'], intent: ['cancel'], required: ['resource', 'intent'], taskType: 'order_cancel', entityConcepts: ['orderId'] })),
    outputSchema: createMockOutputSchema({
      required: ['orderId', 'status'],
      properties: {
        orderId: { type: 'string' },
        status: { type: 'string' },
        sideEffectApplied: { type: 'boolean' }
      },
      allowedFieldPaths: ['orderId', 'status', 'sideEffectApplied'],
      evidenceSafeProvenanceFields: ['orderId']
    }),
    requiredPermissions: ['orders:approve'],
    riskLevel: RiskLevel.high,
    hasSideEffect: true,
    requiresConfirmation: false,
    requiresApproval: true,
    connectorKey: 'mock',
    timeoutMs: 3000,
    auditBehavior: {
      summarizeInput: true,
      summarizeOutput: true
    },
    isActive: true
  },
  {
    name: 'mock.work-orders.progress.lookup',
    version: '1.0.0',
    description: 'Lookup mock work order progress for internal assistant development.',
    resource: 'work_orders',
    operation: ToolOperation.read,
    inputSchema: baseInputSchema(discoveryMetadata({ resource: ['workOrder'], metric: ['progress'], taskType: 'work_order_progress_lookup', entityConcepts: ['workOrderId'] })),
    outputSchema: createMockOutputSchema({
      required: ['workOrderId', 'status'],
      properties: {
        workOrderId: { type: 'string' },
        itemSku: { type: 'string' },
        status: { type: 'string' },
        plannedQuantity: { type: 'number' },
        completedQuantity: { type: 'number' },
        currentOperation: { type: 'string' },
        estimatedCompletionAt: { type: 'string' }
      },
      allowedFieldPaths: [
        'workOrderId',
        'itemSku',
        'status',
        'plannedQuantity',
        'completedQuantity',
        'currentOperation',
        'estimatedCompletionAt'
      ],
      evidenceSafeProvenanceFields: ['workOrderId']
    }),
    requiredPermissions: ['work-orders:read'],
    riskLevel: RiskLevel.low,
    connectorKey: 'mock',
    timeoutMs: 3000,
    auditBehavior: {
      summarizeInput: true,
      summarizeOutput: true
    },
    isActive: true
  },
  {
    name: 'mock.inventory.availability.lookup',
    version: '1.0.0',
    description: 'Lookup mock inventory availability for internal assistant development.',
    resource: 'inventory',
    operation: ToolOperation.read,
    inputSchema: baseInputSchema(discoveryMetadata({ resource: ['inventory'], metric: ['availability'], taskType: 'inventory_availability_lookup', entityConcepts: ['itemSku'] })),
    outputSchema: createMockOutputSchema({
      required: ['itemSku', 'availableQuantity'],
      properties: {
        itemSku: { type: 'string' },
        warehouseCode: { type: 'string' },
        availableQuantity: { type: 'number' },
        allocatedQuantity: { type: 'number' },
        incomingQuantity: { type: 'number' },
        nextReceiptDate: { type: 'string' }
      },
      allowedFieldPaths: [
        'itemSku',
        'warehouseCode',
        'availableQuantity',
        'allocatedQuantity',
        'incomingQuantity',
        'nextReceiptDate'
      ],
      evidenceSafeProvenanceFields: ['itemSku']
    }),
    requiredPermissions: ['inventory:read'],
    riskLevel: RiskLevel.low,
    connectorKey: 'mock',
    timeoutMs: 3000,
    auditBehavior: {
      summarizeInput: true,
      summarizeOutput: true
    },
    isActive: true
  },
  {
    name: 'mock.business-partner.history.lookup',
    version: '1.0.0',
    description: 'Lookup mock customer or supplier history for internal assistant development.',
    resource: 'business_partners',
    operation: ToolOperation.read,
    inputSchema: baseInputSchema(discoveryMetadata({ resource: ['businessPartner'], metric: ['history'], taskType: 'business_partner_history_lookup', entityConcepts: ['customerId', 'supplierId'] })),
    outputSchema: createMockOutputSchema({
      required: ['partnerId', 'relationshipStatus'],
      properties: {
        partnerId: { type: 'string' },
        partnerType: { type: 'string' },
        displayCode: { type: 'string' },
        relationshipStatus: { type: 'string' },
        recentActivitySummary: { type: 'string' },
        openItemCount: { type: 'number' },
        riskNotes: { type: 'array', minItems: 0, maxItems: 100, items: { type: 'string' } }
      },
      allowedFieldPaths: [
        'partnerId',
        'partnerType',
        'displayCode',
        'relationshipStatus',
        'recentActivitySummary',
        'openItemCount',
        'riskNotes'
      ],
      evidenceSafeProvenanceFields: ['partnerId']
    }),
    requiredPermissions: ['business-partners:read'],
    riskLevel: RiskLevel.low,
    connectorKey: 'mock',
    timeoutMs: 3000,
    auditBehavior: {
      summarizeInput: true,
      summarizeOutput: true
    },
    isActive: true
  },
  {
    name: 'inventory.stock-on-hand', version: '1.0.0',
    description: 'Synthetic Customer B stock-on-hand fixture.', resource: 'inventory', operation: ToolOperation.read,
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['sku'], properties: { sku: { type: 'string' } },
      'x-assistant-discovery-v1': discoveryMetadata({ resource: ['inventory', 'stock'], intent: ['read', 'lookup'], metric: ['availability'], taskType: 'inventory_stock_lookup', entityConcepts: ['itemSku'], argumentName: 'sku' })
    },
    outputSchema: createMockOutputSchema({
      required: ['sku', 'quantity'], properties: { sku: { type: 'string' }, quantity: { type: 'number' } },
      allowedFieldPaths: ['sku', 'quantity'], evidenceSafeProvenanceFields: ['sku']
    }),
    requiredPermissions: ['inventory:read'], riskLevel: RiskLevel.low, connectorKey: 'business', timeoutMs: 5000,
    auditBehavior: { summarizeInput: true, summarizeOutput: true }, isActive: true
  }
];

const SHINMONE_REFERENCE_TOOL_DEFINITION = {
  name: 'work-orders.monthly-new-count',
  version: '1.0.0',
  description: 'Count new work orders for the current month through a configured Customer-local connector.',
  resource: 'work_orders',
  operation: ToolOperation.read,
  inputSchema: {
    type: 'object', additionalProperties: false, required: [], properties: {},
    'x-assistant-discovery-v1': discoveryMetadata({
      resource: ['workOrder'], intent: ['read'], metric: ['newCount', 'count'], timeRange: ['this_month'],
      required: ['resource', 'metric', 'timeRange'], taskType: 'work_order_monthly_new_count'
    })
  },
  outputSchema: {
    type: 'object', required: ['metricKey', 'period', 'count'], additionalProperties: false,
    properties: {
      metricKey: { type: 'string', enum: ['work-orders.monthly-new-count'] },
      period: { type: 'string', enum: ['thisMonth'] },
      count: { type: 'integer', minimum: 0 }
    },
    'x-assistant-result-policy': {
      version: '1', allowedFieldPaths: ['metricKey', 'period', 'count'], deniedFieldPaths: [], permissionMasks: [],
      limits: { maxDepth: 2, maxItems: 10, maxStringLength: 128, maxTotalBytes: 4096 },
      evidenceSafeProvenanceFields: ['metricKey', 'period']
    }
  },
  requiredPermissions: ['work-orders:read'],
  riskLevel: RiskLevel.low,
  hasSideEffect: false,
  requiresConfirmation: false,
  requiresApproval: false,
  connectorKey: 'business',
  timeoutMs: 5000,
  auditBehavior: { summarizeInput: true, summarizeOutput: true },
  isActive: true
};

async function main() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required for prisma seed.');
  }

  const prisma = createPrismaClient(databaseUrl);

  try {
    await seedCoreData(prisma);
    await seedUs1TestFixtures(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  void main();
}
