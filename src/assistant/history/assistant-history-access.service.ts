import { Injectable } from '@nestjs/common';
import { createCustomerScopeFromIdentityContext } from '../../identity/customer-scope.factory';
import { RequestIdentityContext } from '../../identity/identity-context.types';
import { AssistantSessionService } from '../session/assistant-session.service';
import { PersistedSession } from '../session/assistant-session.types';

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
}
