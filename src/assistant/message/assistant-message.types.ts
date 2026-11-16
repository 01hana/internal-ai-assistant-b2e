import type { ResolvedExperienceChoice } from '../../assistant-experience/assistant-experience.service';
import { RequestIdentityContext } from '../../identity/identity-context.types';
import { HostIntegrationContext, TransientConnectorContext } from '../../host-integration/host-integration.types';
import { NormalizedPageContext } from '../page-context/page-context.types';
import type { AssistantSseEventRecord } from '../sse/assistant-sse.types';

export interface SendAssistantMessageInput {
  requestId: string;
  sessionId: string;
  message: string;
  identityContext: RequestIdentityContext;
  hostIntegrationContext: HostIntegrationContext;
  pageContext?: NormalizedPageContext;
  transientConnectorContext: TransientConnectorContext;
  /** Feature 013: a clicked Quick Reply or follow-up, already resolved and permission-checked by the server. */
  experienceChoice?: ResolvedExperienceChoice;
  /** Transport-only provisional event sink; omitted by non-HTTP callers. */
  eventSink?: (event: AssistantSseEventRecord) => Promise<void> | void;
  abortSignal?: AbortSignal;
}
