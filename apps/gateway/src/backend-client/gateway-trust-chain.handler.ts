import { isGatewayFeedbackInput, type GatewayFeedbackInput } from './assistant-feedback-input';
import { hasMessageOrChoiceId } from './assistant-message-input';
import { GATEWAY_SESSION_LIST_CURSOR_PATTERN, GATEWAY_SESSION_LIST_LIMIT_PATTERN } from './gateway-backend-client.service';
import type { GatewayBackendClient, GatewayBackendReadResponse, GatewayHistoryQuery, GatewaySessionListQuery } from './gateway-backend-client.service';
import type { CanonicalIdentityResolver } from '../integration-registry/canonical-identity-resolver.service';
import type { UpstreamTokenVerifier } from '../upstream-auth/upstream-token-verifier.service';

type CreateSessionInput = Readonly<{
  authorization?: string;
  pageContext?: Readonly<Record<string, unknown>>;
  requestId: string;
  traceparent?: string;
}>;

type SendStreamMessageInput = Readonly<{
  authorization?: string;
  sessionId: string;
  message?: string;
  choiceId?: string;
  pageContext?: Readonly<Record<string, unknown>>;
  requestId: string;
  traceparent?: string;
}>;

type GetSessionInput = Readonly<{
  authorization?: string;
  sessionId: string;
  requestId: string;
  traceparent?: string;
}>;

type GetSessionMessagesInput = Readonly<{
  authorization?: string;
  sessionId: string;
  query: GatewayHistoryQuery;
  requestId: string;
  traceparent?: string;
}>;

type ListSessionsInput = Readonly<{
  authorization?: string;
  query: GatewaySessionListQuery;
  requestId: string;
  traceparent?: string;
}>;

type SubmitFeedbackInput = Readonly<{
  authorization?: string;
  messageId: string;
  feedback: GatewayFeedbackInput;
  requestId: string;
  traceparent?: string;
}>;

type GatewayTrustChainHandlerDependencies = Readonly<{
  upstreamTokenVerifier: UpstreamTokenVerifier;
  canonicalIdentityResolver: Pick<CanonicalIdentityResolver, 'resolve'>;
  gatewayBackendClient: Pick<GatewayBackendClient, 'createSession' | 'getSession' | 'getSessionMessages' | 'sendStreamMessage' | 'listSessions' | 'archiveSession' | 'unarchiveSession' | 'deleteSession' | 'submitFeedback'>;
}>;

/** Coordinates the fixed identity-to-transport chain without owning either authority. */
export class GatewayTrustChainHandler {
  constructor(private readonly dependencies: GatewayTrustChainHandlerDependencies) {}

  async createSession(input: CreateSessionInput): Promise<unknown> {
    if (!isCreateSessionInput(input)) throw new GatewayTrustChainInputError();

    const verifiedIdentity = await this.dependencies.upstreamTokenVerifier.verify({ authorization: input.authorization, requestId: input.requestId });
    const canonicalIdentity = await this.dependencies.canonicalIdentityResolver.resolve({
      identity: verifiedIdentity,
      requestId: input.requestId
    });
    return this.dependencies.gatewayBackendClient.createSession(canonicalIdentity, {
      pageContext: input.pageContext,
      requestId: input.requestId,
      traceparent: input.traceparent
    });
  }

  async sendStreamMessage(input: SendStreamMessageInput): Promise<ReadableStream<Uint8Array>> {
    if (!isSendStreamMessageInput(input)) throw new GatewayTrustChainInputError();

    const verifiedIdentity = await this.dependencies.upstreamTokenVerifier.verify({ authorization: input.authorization, requestId: input.requestId });
    const canonicalIdentity = await this.dependencies.canonicalIdentityResolver.resolve({
      identity: verifiedIdentity,
      requestId: input.requestId
    });
    return this.dependencies.gatewayBackendClient.sendStreamMessage(canonicalIdentity, input.sessionId, {
      ...(input.message === undefined ? {} : { message: input.message }),
      ...(input.choiceId === undefined ? {} : { choiceId: input.choiceId }),
      pageContext: input.pageContext,
      requestId: input.requestId,
      traceparent: input.traceparent
    });
  }

  async getSession(input: GetSessionInput): Promise<GatewayBackendReadResponse> {
    if (!isGetSessionInput(input)) throw new GatewayTrustChainInputError();
    const canonicalIdentity = await resolveCanonicalIdentity(this.dependencies, input.authorization, input.requestId);
    return this.dependencies.gatewayBackendClient.getSession(canonicalIdentity, input.sessionId, {
      requestId: input.requestId,
      traceparent: input.traceparent
    });
  }

  async getSessionMessages(input: GetSessionMessagesInput): Promise<GatewayBackendReadResponse> {
    if (!isGetSessionMessagesInput(input)) throw new GatewayTrustChainInputError();
    const canonicalIdentity = await resolveCanonicalIdentity(this.dependencies, input.authorization, input.requestId);
    return this.dependencies.gatewayBackendClient.getSessionMessages(canonicalIdentity, input.sessionId, input.query, {
      requestId: input.requestId,
      traceparent: input.traceparent
    });
  }

  async listSessions(input: ListSessionsInput): Promise<GatewayBackendReadResponse> {
    if (!isListSessionsInput(input)) throw new GatewayTrustChainInputError();
    const canonicalIdentity = await resolveCanonicalIdentity(this.dependencies, input.authorization, input.requestId);
    return this.dependencies.gatewayBackendClient.listSessions(canonicalIdentity, input.query, {
      requestId: input.requestId,
      traceparent: input.traceparent
    });
  }

  async archiveSession(input: GetSessionInput): Promise<GatewayBackendReadResponse> {
    if (!isGetSessionInput(input)) throw new GatewayTrustChainInputError();
    const canonicalIdentity = await resolveCanonicalIdentity(this.dependencies, input.authorization, input.requestId);
    return this.dependencies.gatewayBackendClient.archiveSession(canonicalIdentity, input.sessionId, {
      requestId: input.requestId,
      traceparent: input.traceparent
    });
  }

  async unarchiveSession(input: GetSessionInput): Promise<GatewayBackendReadResponse> {
    if (!isGetSessionInput(input)) throw new GatewayTrustChainInputError();
    const canonicalIdentity = await resolveCanonicalIdentity(this.dependencies, input.authorization, input.requestId);
    return this.dependencies.gatewayBackendClient.unarchiveSession(canonicalIdentity, input.sessionId, {
      requestId: input.requestId,
      traceparent: input.traceparent
    });
  }

  async submitFeedback(input: SubmitFeedbackInput): Promise<GatewayBackendReadResponse> {
    if (!isSubmitFeedbackInput(input)) throw new GatewayTrustChainInputError();
    const canonicalIdentity = await resolveCanonicalIdentity(this.dependencies, input.authorization, input.requestId);
    return this.dependencies.gatewayBackendClient.submitFeedback(canonicalIdentity, input.messageId, input.feedback, {
      requestId: input.requestId,
      traceparent: input.traceparent
    });
  }

  async deleteSession(input: GetSessionInput): Promise<GatewayBackendReadResponse> {
    if (!isGetSessionInput(input)) throw new GatewayTrustChainInputError();
    const canonicalIdentity = await resolveCanonicalIdentity(this.dependencies, input.authorization, input.requestId);
    return this.dependencies.gatewayBackendClient.deleteSession(canonicalIdentity, input.sessionId, {
      requestId: input.requestId,
      traceparent: input.traceparent
    });
  }
}

class GatewayTrustChainInputError extends Error {
  constructor() {
    super('Gateway trust-chain input is invalid.');
  }
}

async function resolveCanonicalIdentity(dependencies: GatewayTrustChainHandlerDependencies, authorization: string | undefined, requestId: string) {
  const verifiedIdentity = await dependencies.upstreamTokenVerifier.verify({ authorization, requestId });
  return dependencies.canonicalIdentityResolver.resolve({ identity: verifiedIdentity, requestId });
}

function isCreateSessionInput(value: unknown): value is CreateSessionInput {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  if (keys.some((key) => key !== 'authorization' && key !== 'pageContext' && key !== 'requestId' && key !== 'traceparent')) return false;
  return isOptionalString(value.authorization)
    && isOptionalRecord(value.pageContext)
    && isNonBlankString(value.requestId)
    && isOptionalString(value.traceparent);
}

function isSendStreamMessageInput(value: unknown): value is SendStreamMessageInput {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  if (keys.some((key) => key !== 'authorization' && key !== 'sessionId' && key !== 'message' && key !== 'choiceId' && key !== 'pageContext' && key !== 'requestId' && key !== 'traceparent')) return false;
  return isOptionalString(value.authorization)
    && isNonBlankString(value.sessionId)
    && hasMessageOrChoiceId(value)
    && isOptionalRecord(value.pageContext)
    && isNonBlankString(value.requestId)
    && isOptionalString(value.traceparent);
}

function isGetSessionInput(value: unknown): value is GetSessionInput {
  if (!isRecord(value) || Object.keys(value).some((key) => key !== 'authorization' && key !== 'sessionId' && key !== 'requestId' && key !== 'traceparent')) return false;
  return isOptionalString(value.authorization) && isNonBlankString(value.sessionId) && isNonBlankString(value.requestId) && isOptionalString(value.traceparent);
}

function isSubmitFeedbackInput(value: unknown): value is SubmitFeedbackInput {
  if (!isRecord(value) || Object.keys(value).some((key) => key !== 'authorization' && key !== 'messageId' && key !== 'feedback' && key !== 'requestId' && key !== 'traceparent')) return false;
  return isOptionalString(value.authorization) && isNonBlankString(value.messageId) && isGatewayFeedbackInput(value.feedback)
    && isNonBlankString(value.requestId) && isOptionalString(value.traceparent);
}

function isGetSessionMessagesInput(value: unknown): value is GetSessionMessagesInput {
  if (!isRecord(value) || Object.keys(value).some((key) => key !== 'authorization' && key !== 'sessionId' && key !== 'query' && key !== 'requestId' && key !== 'traceparent')) return false;
  return isOptionalString(value.authorization) && isNonBlankString(value.sessionId) && isHistoryQuery(value.query) && isNonBlankString(value.requestId) && isOptionalString(value.traceparent);
}

function isListSessionsInput(value: unknown): value is ListSessionsInput {
  if (!isRecord(value) || Object.keys(value).some((key) => key !== 'authorization' && key !== 'query' && key !== 'requestId' && key !== 'traceparent')) return false;
  return isOptionalString(value.authorization) && isSessionListQuery(value.query) && isNonBlankString(value.requestId) && isOptionalString(value.traceparent);
}

function isSessionListQuery(value: unknown): value is GatewaySessionListQuery {
  if (!isRecord(value) || Object.keys(value).some((key) => key !== 'limit' && key !== 'cursor' && key !== 'status')) return false;
  return (value.limit === undefined || (typeof value.limit === 'string' && GATEWAY_SESSION_LIST_LIMIT_PATTERN.test(value.limit)))
    && (value.cursor === undefined || (typeof value.cursor === 'string' && GATEWAY_SESSION_LIST_CURSOR_PATTERN.test(value.cursor)))
    && (value.status === undefined || value.status === 'archived');
}

function isHistoryQuery(value: unknown): value is GatewayHistoryQuery {
  if (!isRecord(value) || Object.keys(value).some((key) => key !== 'limit' && key !== 'cursor' && key !== 'order')) return false;
  return (value.limit === undefined || (typeof value.limit === 'string' && /^[0-9]+$/.test(value.limit)))
    && isOptionalString(value.cursor)
    && (value.order === undefined || value.order === 'asc');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOptionalRecord(value: unknown): value is Readonly<Record<string, unknown>> | undefined {
  return value === undefined || isRecord(value);
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
