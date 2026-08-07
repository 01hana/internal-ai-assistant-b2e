import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma/client';
import { RiskLevel, ToolOperation } from '../src/generated/prisma/enums';
import { createPrismaClient } from '../src/prisma/prisma-client.factory';

export async function seedCoreData(prisma: PrismaClient) {
  await seedToolDefinitions(prisma);
  await seedKnowledgeDocuments(prisma);
}

async function seedKnowledgeDocuments(prisma: PrismaClient) {
  for (const document of KNOWLEDGE_DOCUMENT_FIXTURES) {
    const existingDocument = await prisma.knowledgeDocument.findUnique({
      where: {
        sourceKey_version: {
          sourceKey: document.sourceKey,
          version: document.version
        }
      }
    });

    const knowledgeDocument = existingDocument
      ? await prisma.knowledgeDocument.update({
          where: { id: existingDocument.id },
          data: {
            title: document.title,
            sourceType: document.sourceType,
            sourceKey: document.sourceKey,
            version: document.version,
            language: document.language,
            status: document.status,
            metadata: document.metadata
          }
        })
      : await prisma.knowledgeDocument.create({
          data: {
            title: document.title,
            sourceType: document.sourceType,
            sourceKey: document.sourceKey,
            version: document.version,
            language: document.language,
            status: document.status,
            metadata: document.metadata
          }
        });

    await prisma.knowledgeChunk.deleteMany({
      where: {
        documentId: knowledgeDocument.id
      }
    });

    for (const chunk of document.chunks) {
      await prisma.knowledgeChunk.create({
        data: {
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
    title: 'Internal Assistant SOP',
    sourceType: 'sop' as const,
    sourceKey: 'internal-assistant-sop',
    version: '1.0.0',
    language: 'zh-TW',
    status: 'active' as const,
    metadata: { fixture: true },
    chunks: [
      {
        chunkIndex: 0,
        heading: '權限與資料邊界',
        content: '內部後台 AI 助理必須先檢查身份、組織邊界與權限，再查詢資料或呼叫工具。',
        tokenCount: 32
      }
    ]
  },
  {
    title: '退貨處理 SOP',
    sourceType: 'sop' as const,
    sourceKey: 'sop-return-process',
    version: '1.0.0',
    language: 'zh-TW',
    status: 'active' as const,
    metadata: { fixture: true, domain: 'orders' },
    chunks: [
      {
        chunkIndex: 0,
        heading: '退貨流程',
        content: '退貨流程須先確認訂單狀態與收貨紀錄，再依 SOP 建立退貨申請；未完成收貨前不得直接退款。',
        tokenCount: 43
      }
    ]
  },
  {
    title: '訂單狀態欄位說明',
    sourceType: 'field_guide' as const,
    sourceKey: 'field-order-status',
    version: '1.0.0',
    language: 'zh-TW',
    status: 'active' as const,
    metadata: { fixture: true, domain: 'orders' },
    chunks: [
      {
        chunkIndex: 0,
        heading: 'status 欄位',
        content: 'status 欄位代表訂單目前處理階段，例如 draft、confirmed、shipped 或 cancelled；它不是庫存數量欄位。',
        tokenCount: 49
      }
    ]
  }
];

async function seedToolDefinitions(prisma: PrismaClient) {
  for (const tool of MOCK_TOOL_DEFINITIONS) {
    await prisma.toolDefinition.upsert({
      where: {
        name_version: {
          name: tool.name,
          version: tool.version
        }
      },
      update: {
        ...tool,
        isActive: true,
        updatedAt: new Date()
      },
      create: tool
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
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  void main();
}
