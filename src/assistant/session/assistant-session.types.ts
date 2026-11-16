import { AssistantSessionStatus, AssistantTaskState } from '../../generated/prisma/enums';
import { CustomerScope } from '../../identity/customer-scope.types';
import { RequestIdentityContext } from '../../identity/identity-context.types';
import { HostIntegrationContext } from '../../host-integration/host-integration.types';
import { NormalizedPageContext } from '../page-context/page-context.types';
import type { AssistantOpeningV1 } from '../../assistant-experience/assistant-experience.service';

export interface CreateAssistantSessionInput {
  requestId: string;
  hostIntegrationContext: HostIntegrationContext;
  pageContext?: NormalizedPageContext;
  /** Feature 013: greeting and Quick Replies already filtered for this actor; recorded in the audit event. */
  opening?: AssistantOpeningV1;
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

/** Feature 013 US4: one entry of the session history list. */
export interface AssistantSessionListItem {
  sessionId: string;
  title: string | null;
  createdAt: string;
  lastMessageAt: string;
}

export interface AssistantSessionListResult {
  sessions: AssistantSessionListItem[];
  nextCursor: string | null;
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
