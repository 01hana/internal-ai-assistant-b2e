import { NotFoundException } from '@nestjs/common';
import { PersistedExecutionPlan } from '../../src/assistant/planning/assistant-planning.types';
import { assertCustomerWorkflowCreateParents } from '../../src/approvals/customer-workflow-context';
import { PrismaClient } from '../../src/generated/prisma/client';
import { ExecutionDecision, RiskLevel } from '../../src/generated/prisma/enums';
import { CustomerScope } from '../../src/identity/customer-scope.types';

describe('customer workflow create parent context', () => {
  it('accepts distinct same-Customer planning and workflow response messages in the same session', async () => {
    const harness = createDatabaseHarness([message('message-user-a'), message('message-assistant-a')]);

    await expect(assertCustomerWorkflowCreateParents(createInput(harness.db))).resolves.toBeUndefined();

    expect(harness.assistantSession.findFirst).toHaveBeenCalledWith({
      where: {
        customerId: 'customer-a',
        id: 'session-a',
        organizationId: 'org-shared',
        hostApp: 'erp',
        actorId: 'actor-shared'
      }
    });
    expect(harness.assistantMessage.findFirst).toHaveBeenNthCalledWith(1, {
      where: { customerId: 'customer-a', id: 'message-user-a', sessionId: 'session-a' }
    });
    expect(harness.assistantMessage.findFirst).toHaveBeenNthCalledWith(2, {
      where: { customerId: 'customer-a', id: 'message-assistant-a', sessionId: 'session-a' }
    });
  });

  it('fails closed for a foreign planning source message', async () => {
    const harness = createDatabaseHarness([null]);

    await expect(
      assertCustomerWorkflowCreateParents(createInput(harness.db, { executionPlanMessageId: 'message-user-b' }))
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(harness.assistantMessage.findFirst).toHaveBeenCalledWith({
      where: { customerId: 'customer-a', id: 'message-user-b', sessionId: 'session-a' }
    });
  });

  it('fails closed for a foreign workflow response message', async () => {
    const harness = createDatabaseHarness([message('message-user-a'), null]);

    await expect(
      assertCustomerWorkflowCreateParents(createInput(harness.db, { workflowMessageId: 'message-assistant-b' }))
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(harness.assistantMessage.findFirst).toHaveBeenNthCalledWith(2, {
      where: { customerId: 'customer-a', id: 'message-assistant-b', sessionId: 'session-a' }
    });
  });

  it('fails closed when the same-Customer planning message belongs to another session', async () => {
    const harness = createDatabaseHarness([null]);

    await expect(
      assertCustomerWorkflowCreateParents(createInput(harness.db, { executionPlanMessageId: 'message-user-other-session-a' }))
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(harness.assistantMessage.findFirst).toHaveBeenCalledWith({
      where: { customerId: 'customer-a', id: 'message-user-other-session-a', sessionId: 'session-a' }
    });
  });

  it('fails closed when the same-Customer workflow response message belongs to another session', async () => {
    const harness = createDatabaseHarness([message('message-user-a'), null]);

    await expect(
      assertCustomerWorkflowCreateParents(createInput(harness.db, { workflowMessageId: 'message-assistant-other-session-a' }))
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(harness.assistantMessage.findFirst).toHaveBeenNthCalledWith(2, {
      where: { customerId: 'customer-a', id: 'message-assistant-other-session-a', sessionId: 'session-a' }
    });
  });

  it('fails closed before message lookups for a foreign session boundary', async () => {
    const harness = createDatabaseHarness([], null);

    await expect(assertCustomerWorkflowCreateParents(createInput(harness.db))).rejects.toBeInstanceOf(NotFoundException);
    expect(harness.assistantSession.findFirst).toHaveBeenCalledWith({
      where: {
        customerId: 'customer-a',
        id: 'session-a',
        organizationId: 'org-shared',
        hostApp: 'erp',
        actorId: 'actor-shared'
      }
    });
    expect(harness.assistantMessage.findFirst).not.toHaveBeenCalled();
  });
});

function createDatabaseHarness(messageResults: Array<object | null>, sessionResult: object | null = { id: 'session-a' }) {
  const assistantSession = { findFirst: jest.fn().mockResolvedValue(sessionResult) };
  const assistantMessage = {
    findFirst: jest.fn(async () => messageResults.shift() ?? null)
  };

  return {
    assistantSession,
    assistantMessage,
    db: { assistantSession, assistantMessage } as unknown as Pick<PrismaClient, 'assistantSession' | 'assistantMessage'>
  };
}

function createInput(
  db: Pick<PrismaClient, 'assistantSession' | 'assistantMessage'>,
  overrides: { executionPlanMessageId?: string; workflowMessageId?: string } = {}
) {
  return {
    db,
    customerScope: customerScope(),
    sessionId: 'session-a',
    messageId: overrides.workflowMessageId ?? 'message-assistant-a',
    executionPlan: executionPlan(overrides.executionPlanMessageId ?? 'message-user-a')
  };
}

function customerScope(): CustomerScope {
  return {
    customerId: 'customer-a',
    integrationId: 'integration-erp',
    organizationId: 'org-shared',
    hostApp: 'erp',
    actorId: 'actor-shared',
    roles: ['planner'],
    permissionScopes: ['orders:read']
  } as unknown as CustomerScope;
}

function executionPlan(messageId: string): PersistedExecutionPlan {
  return {
    id: 'plan-a',
    customerId: 'customer-a',
    sessionId: 'session-a',
    messageId,
    taskType: 'order_update',
    requiredEvidence: [],
    candidateTools: [],
    permissionChecks: [],
    riskAssessment: RiskLevel.medium,
    clarificationNeeds: null,
    expectedAnswerShape: null,
    requiresMultiStepToolUse: false,
    decision: ExecutionDecision.confirmation_required,
    createdAt: new Date('2026-01-01T00:00:00.000Z')
  };
}

function message(id: string) {
  return { id, customerId: 'customer-a', sessionId: 'session-a' };
}
