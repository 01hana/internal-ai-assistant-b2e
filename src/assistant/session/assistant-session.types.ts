import { AssistantSessionStatus, AssistantTaskState } from '../../generated/prisma/enums';
import { RequestIdentityContext } from '../../identity/identity-context.types';
import { PageContextDto } from '../page-context/page-context.dto';

export interface CreateAssistantSessionInput {
  requestId: string;
  identityContext: RequestIdentityContext;
  pageContext?: PageContextDto;
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
  status: AssistantSessionStatus;
  organizationId: string;
  hostApp: string;
  actorId: string;
}

export interface GetAssistantSessionSummaryInput {
  requestId: string;
  sessionId: string;
  identityContext: RequestIdentityContext;
}
