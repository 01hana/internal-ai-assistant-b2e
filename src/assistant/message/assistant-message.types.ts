import { RequestIdentityContext } from '../../identity/identity-context.types';
import { PageContextDto } from '../page-context/page-context.dto';

export interface SendAssistantMessageInput {
  requestId: string;
  sessionId: string;
  message: string;
  identityContext: RequestIdentityContext;
  pageContext?: PageContextDto;
}
