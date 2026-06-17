import { createUs1DbClient, describeDbBackedUs1 } from '../support/us1-db-test.helper';

describeDbBackedUs1('US1 DB-backed persistence fixtures', () => {
  const prisma = createUs1DbClient();

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('loads deterministic session, context, message, evidence, and audit records from the test database', async () => {
    const session = await prisma.assistantSession.findFirst({
      where: {
        id: 'session-owned-001',
        organizationId: 'org-001',
        hostApp: 'erp',
        actorId: 'actor-001'
      }
    });
    const hiddenSession = await prisma.assistantSession.findFirst({
      where: {
        id: 'session-owned-001',
        organizationId: 'org-999',
        hostApp: 'erp',
        actorId: 'actor-001'
      }
    });
    const contextState = await prisma.assistantContextState.findFirst({
      where: { sessionId: 'session-owned-001' }
    });
    const evidenceRef = await prisma.evidenceRef.findUnique({
      where: { id: 'evidence-owned-001' }
    });
    const toolCall = await prisma.toolCall.findUnique({
      where: { id: 'tool-call-owned-001' }
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
        requestId: 'req-history-seed-001',
        eventType: {
          in: ['session_created', 'message_received', 'evidence_attached', 'answer_generated']
        }
      },
      orderBy: { timestamp: 'asc' }
    });

    expect(session?.id).toBe('session-owned-001');
    expect(hiddenSession).toBeNull();
    expect(contextState).toEqual(
      expect.objectContaining({
        currentTask: 'order_status_lookup',
        currentEntityId: 'SO-10001'
      })
    );
    expect(evidenceRef?.summary).toEqual({
      fields: {
        status: '已確認',
        customerName: '王小明企業'
      }
    });
    expect(evidenceRef?.messageId).toBe('message-owned-assistant-001');
    expect(toolCall?.messageId).toBe('message-owned-assistant-001');
    expect(toolDefinition?.name).toBe('mock.orders.status.lookup');
    expect(toolCall?.toolName).toBe(toolDefinition?.name);
    expect(JSON.stringify(evidenceRef?.summary)).not.toContain('128000');
    expect(auditEvents.map((event) => event.eventType)).toEqual([
      'session_created',
      'message_received',
      'evidence_attached',
      'answer_generated'
    ]);
    expect(JSON.stringify(auditEvents)).not.toContain('selectedRows');
    expect(JSON.stringify(auditEvents)).not.toContain('userVisibleState');
  });
});
