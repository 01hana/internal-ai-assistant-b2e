import { NotFoundException } from '@nestjs/common';
import { PersistedExecutionPlan } from '../assistant/planning/assistant-planning.types';
import { PrismaClient } from '../generated/prisma/client';
import { CustomerScope } from '../identity/customer-scope.types';
import { RequestIdentityContext } from '../identity/identity-context.types';
import { assertCustomerScopeMatchesIdentityContext } from '../identity/customer-scope-consistency';

type WorkflowParentDatabase = Pick<PrismaClient, 'assistantSession' | 'assistantMessage'>;

export async function assertCustomerWorkflowCreateParents(input: {
  db: WorkflowParentDatabase;
  customerScope: CustomerScope;
  sessionId: string;
  messageId: string;
  executionPlan: PersistedExecutionPlan;
}): Promise<void> {
  const { customerScope, executionPlan } = input;
  if (
    executionPlan.customerId !== customerScope.customerId ||
    executionPlan.sessionId !== input.sessionId
  ) {
    throw workflowNotFound();
  }

  const session = await input.db.assistantSession.findFirst({
    where: {
      customerId: customerScope.customerId,
      id: input.sessionId,
      organizationId: customerScope.organizationId,
      hostApp: customerScope.hostApp,
      actorId: customerScope.actorId
    }
  });
  if (!session) throw workflowNotFound();

  const planningMessage = await input.db.assistantMessage.findFirst({
    where: {
      customerId: customerScope.customerId,
      id: executionPlan.messageId,
      sessionId: input.sessionId
    }
  });
  if (!planningMessage) throw workflowNotFound();

  const workflowMessage = await input.db.assistantMessage.findFirst({
    where: {
      customerId: customerScope.customerId,
      id: input.messageId,
      sessionId: input.sessionId
    }
  });
  if (!workflowMessage) throw workflowNotFound();
}

export function workflowNotFound(): NotFoundException {
  return new NotFoundException({ error: 'NOT_FOUND', message: 'Workflow resource not found.' });
}

export function assertCustomerWorkflowIdentityConsistency(
  customerScope: CustomerScope,
  identityContext: RequestIdentityContext
): void {
  assertCustomerScopeMatchesIdentityContext(customerScope, identityContext);
}
