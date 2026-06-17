import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma/client';
import { RiskLevel, ToolOperation } from '../src/generated/prisma/enums';
import { createPrismaClient } from '../src/prisma/prisma-client.factory';

export async function seedCoreData(prisma: PrismaClient) {
  await seedToolDefinitions(prisma);

  const existingDocument = await prisma.knowledgeDocument.findUnique({
    where: {
      sourceKey_version: {
        sourceKey: 'internal-assistant-sop',
        version: '1.0.0'
      }
    }
  });

  if (!existingDocument) {
    await prisma.knowledgeDocument.create({
      data: {
        title: 'Internal Assistant SOP',
        sourceType: 'sop',
        sourceKey: 'internal-assistant-sop',
        version: '1.0.0',
        language: 'zh-TW',
        status: 'active',
        metadata: {
          fixture: true
        },
        chunks: {
          create: {
            chunkIndex: 0,
            heading: '權限與資料邊界',
            content: '內部後台 AI 助理必須先檢查身份、組織邊界與權限，再查詢資料或呼叫工具。',
            tokenCount: 32,
            metadata: {
              fixture: true
            }
          }
        }
      }
    });
    return;
  }

  await prisma.knowledgeDocument.update({
    where: {
      id: existingDocument.id
    },
    data: {
      title: 'Internal Assistant SOP',
      sourceType: 'sop',
      sourceKey: 'internal-assistant-sop',
      version: '1.0.0',
      language: 'zh-TW',
      status: 'active',
      metadata: {
        fixture: true
      }
    }
  });

  await prisma.knowledgeChunk.deleteMany({
    where: {
      documentId: existingDocument.id,
      chunkIndex: 0
    }
  });

  await prisma.knowledgeChunk.create({
    data: {
      documentId: existingDocument.id,
      chunkIndex: 0,
      heading: '權限與資料邊界',
      content: '內部後台 AI 助理必須先檢查身份、組織邊界與權限，再查詢資料或呼叫工具。',
      tokenCount: 32,
      metadata: {
        fixture: true
      }
    }
  });
}

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
