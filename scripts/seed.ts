import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma/client';
import { createPrismaClient } from '../src/prisma/prisma-client.factory';

export async function seedCoreData(prisma: PrismaClient) {
  await prisma.toolDefinition.upsert({
    where: {
      name_version: {
        name: 'mock.orders.status.lookup',
        version: '1.0.0'
      }
    },
    update: {
      isActive: true,
      updatedAt: new Date()
    },
    create: {
      name: 'mock.orders.status.lookup',
      version: '1.0.0',
      description: 'Lookup mock order status for internal assistant development.',
      resource: 'orders',
      operation: 'read',
      inputSchema: {
        type: 'object',
        required: ['orderId'],
        properties: {
          orderId: { type: 'string' }
        }
      },
      outputSchema: {
        type: 'object',
        required: ['orderId', 'status'],
        properties: {
          orderId: { type: 'string' },
          status: { type: 'string' }
        }
      },
      requiredPermissions: ['orders:read'],
      riskLevel: 'low',
      connectorKey: 'mock',
      timeoutMs: 3000,
      auditBehavior: {
        summarizeInput: true,
        summarizeOutput: true
      }
    }
  });

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
