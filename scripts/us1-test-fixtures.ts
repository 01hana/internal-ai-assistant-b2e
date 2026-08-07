import { PrismaClient } from '../src/generated/prisma/client';

const FIXTURE_TIME = new Date('2026-08-04T00:00:00.000Z');
const CUSTOMER_A_ID = 'customer-a';
const CUSTOMER_B_ID = 'customer-b';
const SHARED_IDENTITY = { organizationId: 'org-shared', actorId: 'actor-shared', hostApp: 'erp' };
const SHARED_IDEMPOTENCY_KEY = 'shared-idempotency-key';
const AUDIT_FIXTURE_IDS = [
  'audit-owned-session-001',
  'audit-owned-message-001',
  'audit-owned-evidence-001',
  'audit-hidden-session-001'
] as const;

/** Deterministic rebuildable fixtures; never a retained-data ownership mapping. */
export async function seedUs1TestFixtures(prisma: PrismaClient) {
  await deleteFixtureNamespace(prisma);

  const definition = await prisma.toolDefinition.findUnique({
    where: { name_version: { name: 'mock.orders.status.lookup', version: '1.0.0' } }
  });
  if (!definition) throw new Error('seedCoreData must create mock.orders.status.lookup@1.0.0 before US1 fixtures.');

  const sessionA = await prisma.assistantSession.create({
    data: { id: 'session-owned-001', customerId: CUSTOMER_A_ID, ...SHARED_IDENTITY, status: 'active', createdAt: FIXTURE_TIME, updatedAt: FIXTURE_TIME }
  });
  const sessionB = await prisma.assistantSession.create({
    data: { id: 'session-hidden-001', customerId: CUSTOMER_B_ID, ...SHARED_IDENTITY, status: 'active', createdAt: FIXTURE_TIME, updatedAt: FIXTURE_TIME }
  });

  await prisma.assistantContextState.create({
    data: {
      id: 'context-owned-001', customerId: CUSTOMER_A_ID, sessionId: sessionA.id,
      currentTask: 'order_status_lookup', currentModule: 'orders',
      currentPage: { module: 'orders', screenId: 'order-detail', entityType: 'order', entityId: 'SO-10001', visibleColumns: ['status', 'customerName'] },
      currentEntityType: 'order', currentEntityId: 'SO-10001', lastIntent: 'order_status_lookup',
      lastEntities: [{ type: 'orderId', value: 'SO-10001' }], lastToolCallIds: ['tool-call-owned-001'],
      lastEvidenceRefIds: ['evidence-owned-001'], taskState: 'completed', createdAt: FIXTURE_TIME, updatedAt: FIXTURE_TIME
    }
  });

  const userA = await prisma.assistantMessage.create({
    data: { id: 'message-owned-user-001', customerId: CUSTOMER_A_ID, sessionId: sessionA.id, requestId: 'req-history-seed-001', role: 'user', content: '這張訂單目前狀態？', pageContext: { module: 'orders', entityType: 'order', entityId: 'SO-10001', visibleColumns: ['status', 'customerName'] }, createdAt: FIXTURE_TIME }
  });
  const assistantA = await prisma.assistantMessage.create({
    data: { id: 'message-owned-assistant-001', customerId: CUSTOMER_A_ID, sessionId: sessionA.id, requestId: 'req-history-seed-001', role: 'assistant', content: '這張訂單目前狀態為已確認，客戶名稱是王小明企業。', answerDecision: 'answered', createdAt: FIXTURE_TIME }
  });
  const userB = await prisma.assistantMessage.create({
    data: { id: 'message-hidden-user-001', customerId: CUSTOMER_B_ID, sessionId: sessionB.id, requestId: 'req-history-seed-hidden-001', role: 'user', content: 'Customer B message.', createdAt: FIXTURE_TIME }
  });
  const assistantB = await prisma.assistantMessage.create({
    data: { id: 'message-hidden-assistant-001', customerId: CUSTOMER_B_ID, sessionId: sessionB.id, requestId: 'req-history-seed-hidden-001', role: 'assistant', content: 'Customer B answer.', answerDecision: 'answered', createdAt: FIXTURE_TIME }
  });

  const toolA = await prisma.toolCall.create({
    data: toolCallData(CUSTOMER_A_ID, 'tool-call-owned-001', sessionA.id, assistantA.id, definition.id, 'req-history-seed-001')
  });
  const toolB = await prisma.toolCall.create({
    data: toolCallData(CUSTOMER_B_ID, 'tool-call-hidden-001', sessionB.id, assistantB.id, definition.id, 'req-history-seed-hidden-001')
  });

  const evidenceA = await prisma.evidenceRef.create({
    data: evidenceData(CUSTOMER_A_ID, 'evidence-owned-001', assistantA.id, toolA.id, 'req-history-seed-001')
  });
  await prisma.evidenceRef.create({
    data: evidenceData(CUSTOMER_B_ID, 'evidence-hidden-001', assistantB.id, toolB.id, 'req-history-seed-hidden-001')
  });

  const grounding = await prisma.groundingCheck.create({
    data: { id: 'grounding-owned-001', customerId: CUSTOMER_A_ID, requestId: 'req-history-seed-001', messageId: assistantA.id, covered: true, checkedClaimCount: 2, unsupportedClaimCount: 0, evidenceRefIds: [evidenceA.id], metadata: { fixture: true }, createdAt: FIXTURE_TIME }
  });
  await prisma.answerDecision.create({
    data: { id: 'answer-owned-001', customerId: CUSTOMER_A_ID, requestId: 'req-history-seed-001', messageId: assistantA.id, status: 'answered', groundingCheckId: grounding.id, metadata: { selectedEvidenceCount: 1 }, createdAt: FIXTURE_TIME }
  });

  await prisma.auditEvent.createMany({
    data: [
      auditData('audit-owned-session-001', CUSTOMER_A_ID, sessionA.id, null, null, 'session_created', 'req-history-seed-001'),
      auditData('audit-owned-message-001', CUSTOMER_A_ID, sessionA.id, userA.id, null, 'message_received', 'req-history-seed-001'),
      auditData('audit-owned-evidence-001', CUSTOMER_A_ID, sessionA.id, assistantA.id, toolA.id, 'evidence_attached', 'req-history-seed-001', [evidenceA.id]),
      auditData('audit-hidden-session-001', CUSTOMER_B_ID, sessionB.id, userB.id, toolB.id, 'session_created', 'req-history-seed-hidden-001')
    ]
  });
}

function toolCallData(customerId: string, id: string, sessionId: string, messageId: string, toolDefinitionId: string, requestId: string) {
  return { id, customerId, requestId, sessionId, messageId, toolDefinitionId, toolName: 'mock.orders.status.lookup', toolVersion: '1.0.0', idempotencyKey: SHARED_IDEMPOTENCY_KEY, inputSummary: { entityId: 'SO-10001', visibleFields: ['status', 'customerName'] }, permissionResult: { scopes: ['orders:read'], visibleFields: ['status', 'customerName'] }, outputSummary: { status: '已確認', customerName: '王小明企業' }, status: 'success' as const, executionStatus: 'executed' as const, durationMs: 1, createdAt: FIXTURE_TIME, executedAt: FIXTURE_TIME };
}

function evidenceData(customerId: string, id: string, messageId: string, toolCallId: string, requestId: string) {
  return { id, customerId, requestId, messageId, sourceType: 'structured_record' as const, sourceId: 'SO-10001', toolCallId, entityType: 'order', entityId: 'SO-10001', fieldPaths: ['status', 'customerName'], timestamp: FIXTURE_TIME, permissionSnapshot: { visibleFields: ['status', 'customerName'] }, summary: { fields: { status: '已確認', customerName: '王小明企業' } } };
}

function auditData(id: string, customerId: string, sessionId: string, messageId: string | null, toolCallId: string | null, eventType: string, requestId: string, evidenceRefIds: string[] = []) {
  return { id, customerId, requestId, timestamp: FIXTURE_TIME, organizationId: SHARED_IDENTITY.organizationId, hostApp: SHARED_IDENTITY.hostApp, actorId: SHARED_IDENTITY.actorId, sessionId, messageId, toolCallId, eventType, evidenceRefIds, metadata: { fixture: true } };
}

async function deleteFixtureNamespace(prisma: PrismaClient) {
  const customers = [CUSTOMER_A_ID, CUSTOMER_B_ID];
  const sessions = ['session-owned-001', 'session-hidden-001'];
  const messages = ['message-owned-user-001', 'message-owned-assistant-001', 'message-hidden-user-001', 'message-hidden-assistant-001'];
  await prisma.auditEvent.deleteMany({ where: { customerId: { in: customers }, id: { in: [...AUDIT_FIXTURE_IDS] } } });
  await prisma.answerDecision.deleteMany({ where: { customerId: CUSTOMER_A_ID, id: 'answer-owned-001' } });
  await prisma.groundingCheck.deleteMany({ where: { customerId: CUSTOMER_A_ID, id: 'grounding-owned-001' } });
  await prisma.evidenceRef.deleteMany({ where: { customerId: { in: customers }, id: { in: ['evidence-owned-001', 'evidence-hidden-001'] } } });
  await prisma.toolCall.deleteMany({ where: { customerId: { in: customers }, id: { in: ['tool-call-owned-001', 'tool-call-hidden-001'] } } });
  await prisma.assistantContextState.deleteMany({ where: { customerId: CUSTOMER_A_ID, id: 'context-owned-001' } });
  await prisma.assistantMessage.deleteMany({ where: { customerId: { in: customers }, id: { in: messages } } });
  await prisma.assistantSession.deleteMany({ where: { customerId: { in: customers }, id: { in: sessions } } });
}
