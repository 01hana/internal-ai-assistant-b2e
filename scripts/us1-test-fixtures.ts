import { PrismaClient } from '../src/generated/prisma/client';

export async function seedUs1TestFixtures(prisma: PrismaClient) {
  const session = await prisma.assistantSession.create({
    data: {
      id: 'session-owned-001',
      hostApp: 'erp',
      organizationId: 'org-001',
      actorId: 'actor-001',
      status: 'active'
    }
  });

  await prisma.assistantSession.create({
    data: {
      id: 'session-hidden-001',
      hostApp: 'erp',
      organizationId: 'org-001',
      actorId: 'actor-002',
      status: 'active'
    }
  });

  await prisma.assistantContextState.create({
    data: {
      sessionId: session.id,
      currentTask: 'order_status_lookup',
      currentModule: 'orders',
      currentPage: {
        module: 'orders',
        screenId: 'order-detail',
        entityType: 'order',
        entityId: 'SO-10001',
        visibleColumns: ['status', 'customerName']
      },
      currentEntityType: 'order',
      currentEntityId: 'SO-10001',
      lastIntent: 'order_status_lookup',
      lastEntities: [{ type: 'orderId', value: 'SO-10001' }],
      lastToolCallIds: ['tool-call-owned-001'],
      lastEvidenceRefIds: ['evidence-owned-001'],
      taskState: 'completed'
    }
  });

  const userMessage = await prisma.assistantMessage.create({
    data: {
      id: 'message-owned-user-001',
      sessionId: session.id,
      requestId: 'req-history-seed-001',
      role: 'user',
      content: '這張訂單目前狀態？',
      pageContext: {
        module: 'orders',
        entityType: 'order',
        entityId: 'SO-10001',
        visibleColumns: ['status', 'customerName']
      }
    }
  });

  const assistantMessage = await prisma.assistantMessage.create({
    data: {
      id: 'message-owned-assistant-001',
      sessionId: session.id,
      requestId: 'req-history-seed-001',
      role: 'assistant',
      content: '這張訂單目前狀態為已確認，客戶名稱是王小明企業。',
      answerDecision: 'answered'
    }
  });

  const toolCall = await prisma.toolCall.create({
    data: {
      id: 'tool-call-owned-001',
      requestId: 'req-history-seed-001',
      sessionId: session.id,
      messageId: assistantMessage.id,
      toolName: 'mock.orders.status.lookup',
      toolVersion: 'v1',
      inputSummary: {
        entityId: 'SO-10001',
        visibleFields: ['status', 'customerName']
      },
      permissionResult: {
        scopes: ['orders:read'],
        visibleFields: ['status', 'customerName']
      },
      outputSummary: {
        status: '已確認',
        customerName: '王小明企業'
      },
      status: 'success',
      executionStatus: 'executed',
      durationMs: 1,
      executedAt: new Date()
    }
  });

  const evidenceRef = await prisma.evidenceRef.create({
    data: {
      id: 'evidence-owned-001',
      requestId: 'req-history-seed-001',
      messageId: assistantMessage.id,
      sourceType: 'structured_record',
      sourceId: 'SO-10001',
      toolCallId: toolCall.id,
      entityType: 'order',
      entityId: 'SO-10001',
      fieldPaths: ['status', 'customerName'],
      permissionSnapshot: {
        visibleFields: ['status', 'customerName']
      },
      summary: {
        fields: {
          status: '已確認',
          customerName: '王小明企業'
        }
      }
    }
  });

  const groundingCheck = await prisma.groundingCheck.create({
    data: {
      requestId: 'req-history-seed-001',
      messageId: assistantMessage.id,
      covered: true,
      checkedClaimCount: 2,
      unsupportedClaimCount: 0,
      evidenceRefIds: [evidenceRef.id],
      metadata: {
        fixture: true
      }
    }
  });

  await prisma.answerDecision.create({
    data: {
      requestId: 'req-history-seed-001',
      messageId: assistantMessage.id,
      status: 'answered',
      groundingCheckId: groundingCheck.id,
      metadata: {
        selectedEvidenceCount: 1
      }
    }
  });

  await prisma.auditEvent.createMany({
    data: [
      {
        requestId: 'req-history-seed-001',
        organizationId: 'org-001',
        hostApp: 'erp',
        actorId: 'actor-001',
        sessionId: session.id,
        eventType: 'session_created',
        evidenceRefIds: [],
        metadata: { fixture: true }
      },
      {
        requestId: 'req-history-seed-001',
        organizationId: 'org-001',
        hostApp: 'erp',
        actorId: 'actor-001',
        sessionId: session.id,
        messageId: userMessage.id,
        eventType: 'message_received',
        evidenceRefIds: [],
        metadata: { pageContext: { module: 'orders', entityType: 'order', entityId: 'SO-10001' } }
      },
      {
        requestId: 'req-history-seed-001',
        organizationId: 'org-001',
        hostApp: 'erp',
        actorId: 'actor-001',
        sessionId: session.id,
        messageId: assistantMessage.id,
        toolCallId: toolCall.id,
        eventType: 'evidence_attached',
        evidenceRefIds: [evidenceRef.id],
        metadata: { evidenceRefId: evidenceRef.id, sourceType: 'structured_record' }
      },
      {
        requestId: 'req-history-seed-001',
        organizationId: 'org-001',
        hostApp: 'erp',
        actorId: 'actor-001',
        sessionId: session.id,
        messageId: assistantMessage.id,
        decision: 'answered',
        toolCallId: toolCall.id,
        eventType: 'answer_generated',
        evidenceRefIds: [evidenceRef.id],
        metadata: { toolName: 'mock.orders.status.lookup' }
      }
    ]
  });
}
