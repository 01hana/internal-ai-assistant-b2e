import { Injectable } from '@nestjs/common';
import { createCustomerScopeFromIdentityContext } from '../../identity/customer-scope.factory';
import { RequestIdentityContext } from '../../identity/identity-context.types';
import { AssistantSessionService } from '../session/assistant-session.service';
import { PersistedSession } from '../session/assistant-session.types';
import { isCompletedAssistantMessage } from '../message/assistant-completion.predicate';

export interface EnsureHistoryAccessInput {
  requestId: string;
  sessionId: string;
  identityContext: RequestIdentityContext;
}

@Injectable()
export class AssistantHistoryAccessService {
  constructor(
    private readonly sessionService: AssistantSessionService
  ) {}

  async ensureVisibleActiveSession(input: EnsureHistoryAccessInput): Promise<PersistedSession> {
    const customerScope = createCustomerScopeFromIdentityContext(input.identityContext);
    return this.sessionService.getVisibleSession(input.sessionId, customerScope);
  }

  isCompletedHistoryMessage(message: {
    readonly role: string;
    readonly content: string;
    readonly answerDecision?: string | null;
    readonly answerDecisions?: ReadonlyArray<{ readonly id: string; readonly status: string; readonly groundingCheckId: string | null }>;
  }): boolean {
    return message.role !== 'assistant' || isCompletedAssistantMessage(message, message.answerDecisions?.[0]);
  }
}
