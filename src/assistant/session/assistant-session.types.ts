import { AssistantSessionStatus, AssistantTaskState } from '../../generated/prisma/enums';
import { CustomerScope } from '../../identity/customer-scope.types';
import { RequestIdentityContext } from '../../identity/identity-context.types';
import { HostIntegrationContext } from '../../host-integration/host-integration.types';
import { NormalizedPageContext } from '../page-context/page-context.types';

export interface CreateAssistantSessionInput {
  requestId: string;
  hostIntegrationContext: HostIntegrationContext;
  pageContext?: NormalizedPageContext;
}

export interface AssistantSessionSummary {
  sessionId: string;
  status: AssistantSessionStatus;
  contextState: {
    taskState: AssistantTaskState;
    currentTask?: string;
    currentModule?: string;
    currentEntityType?: string;
    currentEntityId?: string;
  };
}

export interface PersistedSession {
  id: string;
  customerId: string;
  integrationId: string | null;
  status: AssistantSessionStatus;
  organizationId: string;
  hostApp: string;
  actorId: string;
}

export type VisibleAssistantSession = PersistedSession;

export interface CloseAssistantSessionInput {
  customerScope: CustomerScope;
  sessionId: string;
}

export interface CloseAssistantSessionResult {
  sessionId: string;
  status: typeof AssistantSessionStatus.closed;
}

export interface GetAssistantSessionSummaryInput {
  requestId: string;
  sessionId: string;
  identityContext: RequestIdentityContext;
}
