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
  /** Transport-only provisional event sink; omitted by non-HTTP callers. */
  eventSink?: (event: AssistantSseEventRecord) => Promise<void> | void;
  abortSignal?: AbortSignal;
}
