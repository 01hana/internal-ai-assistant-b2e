import { createUs1DbClient, describeDbBackedUs1 } from '../support/us1-db-test.helper';
import { CUSTOMER_SCOPE_FIXTURES } from '../support/customer-scope-fixtures';

describeDbBackedUs1('US1 DB-backed persistence fixtures', () => {
  const prisma = createUs1DbClient();

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('loads deterministic session, context, message, evidence, and audit records from the test database', async () => {
    const { customerA, customerB, shared } = CUSTOMER_SCOPE_FIXTURES;
    const session = await prisma.assistantSession.findFirst({
      where: {
        customerId: customerA.root.id,
        id: customerA.seed.sessionId,
        organizationId: shared.organizationId,
        hostApp: shared.hostApp,
        actorId: shared.actorId
      }
    });
    const hiddenSession = await prisma.assistantSession.findFirst({
      where: {
        customerId: customerA.root.id,
        id: customerB.seed.sessionId,
        organizationId: shared.organizationId,
        hostApp: shared.hostApp,
        actorId: shared.actorId
      }
    });
    const contextState = await prisma.assistantContextState.findFirst({
      where: { customerId: customerA.root.id, id: 'context-owned-001', sessionId: customerA.seed.sessionId }
    });
    const messages = await prisma.assistantMessage.findMany({
      where: {
        customerId: customerA.root.id,
        sessionId: customerA.seed.sessionId,
        id: { in: [customerA.seed.userMessageId, customerA.seed.assistantMessageId] }
      },
      orderBy: { createdAt: 'asc' }
    });
    const evidenceRef = await prisma.evidenceRef.findFirst({
      where: { customerId: customerA.root.id, id: 'evidence-owned-001' }
    });
    const toolCall = await prisma.toolCall.findFirst({
      where: { customerId: customerA.root.id, id: customerA.seed.toolCallId }
    });
    const toolDefinition = await prisma.toolDefinition.findUnique({
      where: {
        name_version: {
          name: 'mock.orders.status.lookup',
          version: '1.0.0'
        }
      }
    });
    const auditEvents = await prisma.auditEvent.findMany({
      where: {
        customerId: customerA.root.id,
        sessionId: customerA.seed.sessionId,
        requestId: 'req-history-seed-001',
        eventType: {
          in: ['session_created', 'message_received', 'evidence_attached']
        }
      },
      orderBy: { timestamp: 'asc' }
    });

    expect(session).toEqual(
      expect.objectContaining({
        id: customerA.seed.sessionId,
        customerId: customerA.root.id,
        organizationId: shared.organizationId,
        actorId: shared.actorId,
        hostApp: shared.hostApp
      })
    );
    expect(hiddenSession).toBeNull();
    expect(contextState).toEqual(
      expect.objectContaining({
        customerId: customerA.root.id,
        sessionId: customerA.seed.sessionId,
        currentTask: 'order_status_lookup',
        currentEntityId: 'SO-10001'
      })
    );
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: customerA.seed.userMessageId,
          customerId: customerA.root.id,
          sessionId: customerA.seed.sessionId,
          role: 'user'
        }),
        expect.objectContaining({
          id: customerA.seed.assistantMessageId,
          customerId: customerA.root.id,
          sessionId: customerA.seed.sessionId,
          role: 'assistant'
        })
      ])
    );
    expect(evidenceRef?.summary).toEqual({
      fields: {
        status: '已確認',
        customerName: '王小明企業'
      }
    });
    expect(evidenceRef).toEqual(
      expect.objectContaining({
        customerId: customerA.root.id,
        messageId: customerA.seed.assistantMessageId,
        toolCallId: customerA.seed.toolCallId
      })
    );
    expect(toolCall).toEqual(
      expect.objectContaining({
        customerId: customerA.root.id,
        messageId: customerA.seed.assistantMessageId
      })
    );
    expect(toolDefinition?.name).toBe('mock.orders.status.lookup');
    expect(toolCall?.toolName).toBe(toolDefinition?.name);
    expect(JSON.stringify(evidenceRef?.summary)).not.toContain('128000');
    expect(auditEvents.map((event) => event.eventType)).toEqual(['session_created', 'message_received', 'evidence_attached']);
    expect(auditEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ customerId: customerA.root.id, sessionId: customerA.seed.sessionId })
      ])
    );
    expect(JSON.stringify(auditEvents)).not.toContain('selectedRows');
    expect(JSON.stringify(auditEvents)).not.toContain('userVisibleState');
  });
});
