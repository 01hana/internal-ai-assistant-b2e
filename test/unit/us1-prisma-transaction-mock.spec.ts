import { createUs1PrismaMockForTest, createUs1TestStateForTest } from '../support/us1-test-app.helper';
import {
  ActionDraftStatus,
  ApprovalRequestStatus,
  EscalationStatus,
  ToolCallStatus,
  ToolExecutionStatus
} from '../../src/generated/prisma/enums';

describe('US1 Prisma transaction mock', () => {
  it('keeps successful workflow, audit, and ToolCall mutations', async () => {
    const state = createUs1TestStateForTest();
    const prisma = createUs1PrismaMockForTest(state);
    await prisma.$transaction(async (db: any) => {
      await db.approvalRequest.updateMany({
        where: { customerId: 'customer-a', id: 'approval-request-pending-get-001' },
        data: { status: ApprovalRequestStatus.approved }
      });
      await db.actionDraft.updateMany({
        where: { customerId: 'customer-a', id: 'action-draft-draft-001' },
        data: { status: ActionDraftStatus.waiting_confirmation }
      });
      await db.auditEvent.create({ data: { customerId: 'customer-a', requestId: 'tx-ok', organizationId: 'org-shared', hostApp: 'erp', actorId: 'actor-shared', eventType: 'tx_ok', evidenceRefIds: [] } });
      await db.toolCall.create({
        data: {
          customerId: 'customer-a',
          requestId: 'tx-ok',
          sessionId: 'session-owned-001',
          messageId: 'message-owned-assistant-001',
          toolName: 'mock.orders.status.update',
          idempotencyKey: 'idem-tx-ok',
          status: ToolCallStatus.success,
          executionStatus: ToolExecutionStatus.executed
        }
      });
    });
    expect(state.approvalRequests.find((item) => item.id === 'approval-request-pending-get-001')?.status).toBe('approved');
    expect(state.actionDrafts.find((item) => item.id === 'action-draft-draft-001')?.status).toBe('waiting_confirmation');
    expect(state.auditEvents.some((item) => item.eventType === 'tx_ok')).toBe(true);
    expect(state.toolCalls).toContainEqual(expect.objectContaining({
      customerId: 'customer-a',
      sessionId: 'session-owned-001',
      messageId: 'message-owned-assistant-001',
      idempotencyKey: 'idem-tx-ok'
    }));
    expect(prisma.approvalRequest.updateMany).toHaveBeenCalled();
    expect(prisma.actionDraft.updateMany).toHaveBeenCalled();
    expect(prisma.auditEvent.create).toHaveBeenCalled();
    expect(prisma.toolCall.create).toHaveBeenCalled();
  });

  it('restores state after a failed callback while preserving mock history', async () => {
    const state = createUs1TestStateForTest();
    const prisma = createUs1PrismaMockForTest(state);
    const approvalId = 'approval-request-pending-get-001';
    const actionId = 'action-draft-executed-001';
    const escalationId = 'escalation-request-resolved-001';
    const deletedId = 'approval-request-pending-cancel-001';
    const beforeApproval = structuredClone(state.approvalRequests.find((item) => item.id === approvalId));
    const beforeAction = structuredClone(state.actionDrafts.find((item) => item.id === actionId));
    const beforeEscalation = structuredClone(state.escalationRequests.find((item) => item.id === escalationId));
    const beforeDeleted = structuredClone(state.approvalRequests.find((item) => item.id === deletedId));
    await expect(prisma.$transaction(async (db: any) => {
      await db.approvalRequest.updateMany({
        where: { customerId: 'customer-a', id: approvalId },
        data: { status: ApprovalRequestStatus.rejected, decidedAt: new Date('2026-08-06T00:00:00.000Z'), actionSummary: { nested: { changed: true } } }
      });
      await db.actionDraft.updateMany({
        where: { customerId: 'customer-a', id: actionId },
        data: { status: ActionDraftStatus.cancelled, confirmedAt: new Date('2026-08-06T00:00:01.000Z'), executedAt: new Date('2026-08-06T00:00:02.000Z') }
      });
      await db.escalationRequest.updateMany({
        where: { customerId: 'customer-a', id: escalationId },
        data: { status: EscalationStatus.cancelled, resolvedAt: new Date('2026-08-06T00:00:03.000Z'), summary: { nested: { changed: true } } }
      });
      await db.auditEvent.create({ data: { customerId: 'customer-a', requestId: 'tx-fail', organizationId: 'org-shared', hostApp: 'erp', actorId: 'actor-shared', eventType: 'tx_fail', evidenceRefIds: [] } });
      await db.toolCall.create({
        data: {
          customerId: 'customer-a',
          requestId: 'tx-fail',
          sessionId: 'session-owned-001',
          messageId: 'message-owned-assistant-001',
          toolName: 'mock.orders.status.update',
          idempotencyKey: 'idem-tx-fail',
          status: ToolCallStatus.success,
          executionStatus: ToolExecutionStatus.executed
        }
      });
      await db.approvalRequest.delete({ where: { customerId: 'customer-a', id: deletedId } });
      throw new Error('rollback-marker');
    })).rejects.toThrow('rollback-marker');
    expect(state.approvalRequests.find((item) => item.id === approvalId)).toEqual(beforeApproval);
    expect(state.actionDrafts.find((item) => item.id === actionId)).toEqual(beforeAction);
    expect(state.escalationRequests.find((item) => item.id === escalationId)).toEqual(beforeEscalation);
    expect(state.approvalRequests.find((item) => item.id === deletedId)).toEqual(beforeDeleted);
    expect(state.auditEvents.some((item) => item.eventType === 'tx_fail')).toBe(false);
    expect(state.toolCalls.some((item) => item.idempotencyKey === 'idem-tx-fail')).toBe(false);
    expect(state.approvalRequests.find((item) => item.id === approvalId)?.decidedAt).toBeNull();
    expect(Object.prototype.toString.call(state.actionDrafts.find((item) => item.id === actionId)?.executedAt)).toBe('[object Date]');
    expect(Object.prototype.toString.call(state.escalationRequests.find((item) => item.id === escalationId)?.resolvedAt)).toBe('[object Date]');
    expect((state.escalationRequests.find((item) => item.id === escalationId)?.resolvedAt as Date).toISOString()).toBe(
      (beforeEscalation?.resolvedAt as Date).toISOString()
    );
    expect(prisma.auditEvent.create).toHaveBeenCalled();
    expect(prisma.toolCall.create).toHaveBeenCalled();
    expect(prisma.approvalRequest.delete).toHaveBeenCalled();
  });
});
