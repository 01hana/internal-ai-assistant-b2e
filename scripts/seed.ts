import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma/client';
import { RiskLevel, ToolOperation } from '../src/generated/prisma/enums';
import { createPrismaClient } from '../src/prisma/prisma-client.factory';
import { seedUs1TestFixtures } from './us1-test-fixtures';

const FIXTURE_TIME = new Date('2026-08-04T00:00:00.000Z');
const CUSTOMER_A_ID = 'customer-a';
const CUSTOMER_B_ID = 'customer-b';

export async function seedCoreData(prisma: PrismaClient) {
  await seedCustomers(prisma);
  const toolDefinitions = await seedToolDefinitions(prisma);
  await seedCustomerToolPolicies(prisma, toolDefinitions);
  await seedKnowledgeDocuments(prisma);
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
  for (const tool of MOCK_TOOL_DEFINITIONS) {
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
  const lookup = toolDefinitions.find((tool) => tool.name === 'mock.orders.status.lookup' && tool.version === '1.0.0');
  if (!lookup) throw new Error('Required global ToolDefinition mock.orders.status.lookup@1.0.0 was not seeded.');
  for (const customerId of [CUSTOMER_A_ID, CUSTOMER_B_ID]) {
    await prisma.customerToolPolicy.upsert({
      where: { customerId_toolDefinitionId: { customerId, toolDefinitionId: lookup.id } },
      update: { enabled: true, requiredRoles: [], requiredPermissionScopes: [] },
      create: { customerId, toolDefinitionId: lookup.id, enabled: true, requiredRoles: [], requiredPermissionScopes: [] }
    });
  }
}

const baseInputSchema = {
  type: 'object',
  required: ['entityId'],
  properties: {
    entityId: { type: 'string' }
  }
};

const MOCK_TOOL_DEFINITIONS = [
  {
    name: 'mock.orders.status.lookup',
    version: '1.0.0',
    description: 'Lookup mock order status for internal assistant development.',
    resource: 'orders',
    operation: ToolOperation.read,
    inputSchema: baseInputSchema,
    outputSchema: {
      type: 'object',
      required: ['orderId', 'status'],
      properties: {
        orderId: { type: 'string' },
        status: { type: 'string' }
      }
    },
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
    inputSchema: baseInputSchema,
    outputSchema: {
      type: 'object',
      required: ['orderId', 'status'],
      properties: {
        orderId: { type: 'string' },
        status: { type: 'string' }
      }
    },
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
    inputSchema: baseInputSchema,
    outputSchema: {
      type: 'object',
      required: ['orderId', 'status'],
      properties: {
        orderId: { type: 'string' },
        status: { type: 'string' }
      }
    },
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
    inputSchema: baseInputSchema,
    outputSchema: {
      type: 'object',
      required: ['workOrderId', 'status'],
      properties: {
        workOrderId: { type: 'string' },
        status: { type: 'string' }
      }
    },
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
    inputSchema: baseInputSchema,
    outputSchema: {
      type: 'object',
      required: ['itemSku', 'availableQuantity'],
      properties: {
        itemSku: { type: 'string' },
        availableQuantity: { type: 'number' }
      }
    },
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
    inputSchema: baseInputSchema,
    outputSchema: {
      type: 'object',
      required: ['partnerId', 'relationshipStatus'],
      properties: {
        partnerId: { type: 'string' },
        relationshipStatus: { type: 'string' }
      }
    },
    requiredPermissions: ['business-partners:read'],
    riskLevel: RiskLevel.low,
    connectorKey: 'mock',
    timeoutMs: 3000,
    auditBehavior: {
      summarizeInput: true,
      summarizeOutput: true
    },
    isActive: true
  }
];

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
