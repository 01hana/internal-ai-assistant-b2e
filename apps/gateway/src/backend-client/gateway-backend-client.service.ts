import { isGatewayFeedbackInput, toGatewayFeedbackInput, type GatewayFeedbackInput } from './assistant-feedback-input';
import { hasMessageOrChoiceId } from './assistant-message-input';
import type { CanonicalGatewayIdentity } from '../identity/canonical-gateway-identity';
import { BACKEND_ROUTE_DEFINITIONS } from './backend-route-definition';

type CreateSessionInput = Readonly<{
  pageContext?: Readonly<Record<string, unknown>>;
  requestId?: string;
  traceparent?: string;
}>;

type SendStreamMessageInput = Readonly<{
  message?: string;
  choiceId?: string;
  pageContext?: Readonly<Record<string, unknown>>;
  requestId?: string;
  traceparent?: string;
}>;

export type GatewayHistoryQuery = Readonly<{
  limit?: string;
  cursor?: string;
  order?: 'asc';
}>;

/** Feature 013 US4: opaque keyset paging for the actor's own session list. */
export type GatewaySessionListQuery = Readonly<{
  limit?: string;
  cursor?: string;
  /** Only `archived`; omitted for the active list. */
  status?: 'archived';
}>;

export const GATEWAY_SESSION_LIST_LIMIT_PATTERN = /^[0-9]{1,3}$/;
export const GATEWAY_SESSION_LIST_CURSOR_PATTERN = /^[A-Za-z0-9_-]{1,200}$/;

type ReadOperation = 'get-session' | 'get-session-messages' | 'list-sessions' | 'archive-session' | 'unarchive-session' | 'delete-session' | 'submit-feedback';

export type GatewayBackendReadResponse = Readonly<{
  statusCode: number;
  body: unknown;
}>;

type ReadInput = Readonly<{
  requestId: string;
  traceparent?: string;
}>;

type BackendFetchResponse = Readonly<{
  ok: boolean;
  status: number;
  json?: () => Promise<unknown>;
  body?: unknown;
}>;

type GatewayBackendClientDependencies = Readonly<{
  backendBaseUrl: string;
  timeoutMilliseconds: number;
  internalTokenIssuer: Readonly<{ issue(identity: CanonicalGatewayIdentity): Promise<string> }>;
  fetch(url: string, init: Readonly<{
    method: 'GET' | 'POST' | 'DELETE';
    headers: Record<string, string>;
    body?: string;
    signal: AbortSignal;
  }>): Promise<BackendFetchResponse>;
  createTimeoutSignal(milliseconds: number): AbortSignal;
  createAbortController(): AbortController;
}>;

/** A narrow, server-owned transport for the fixed Backend operation catalogue. */
export class GatewayBackendClient {
  constructor(private readonly dependencies: GatewayBackendClientDependencies) {}

  async createSession(identity: CanonicalGatewayIdentity, input: CreateSessionInput): Promise<unknown> {
    if (!isCreateSessionInput(input)) throw new BackendUnavailableError();

    const token = await this.dependencies.internalTokenIssuer.issue(identity);
    const route = BACKEND_ROUTE_DEFINITIONS['create-session'];
    const headers = {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json',
      ...correlationHeader('x-request-id', input.requestId),
      ...correlationHeader('traceparent', input.traceparent)
    };
    const body = JSON.stringify({ pageContext: input.pageContext });

    try {
      const response = await this.dependencies.fetch(new URL(route.path, this.dependencies.backendBaseUrl).toString(), {
        method: route.method,
        headers,
        body,
        signal: this.dependencies.createTimeoutSignal(this.dependencies.timeoutMilliseconds)
      });
      if (!response.ok || typeof response.json !== 'function') throw new BackendUnavailableError();
      return await response.json();
    } catch {
      throw new BackendUnavailableError();
    }
  }

  async getSession(identity: CanonicalGatewayIdentity, sessionId: string, input: ReadInput): Promise<GatewayBackendReadResponse> {
    if (!isNonBlankString(sessionId) || !isReadInput(input)) throw new BackendUnavailableError();
    return this.fetchRead(identity, 'get-session', sessionId, undefined, input, SESSION_READ_FAILURES);
  }

  async getSessionMessages(identity: CanonicalGatewayIdentity, sessionId: string, query: GatewayHistoryQuery, input: ReadInput): Promise<GatewayBackendReadResponse> {
    if (!isNonBlankString(sessionId) || !isHistoryQuery(query) || !isReadInput(input)) throw new BackendUnavailableError();
    return this.fetchRead(identity, 'get-session-messages', sessionId, query, input, SESSION_READ_FAILURES);
  }

  /** Feature 013 US4. Core rejects an out-of-range limit or undecodable cursor with a safe 400, which passes through. */
  async listSessions(identity: CanonicalGatewayIdentity, query: GatewaySessionListQuery, input: ReadInput): Promise<GatewayBackendReadResponse> {
    if (!isSessionListQuery(query) || !isReadInput(input)) throw new BackendUnavailableError();
    return this.fetchRead(identity, 'list-sessions', undefined, query, input, SESSION_LIST_FAILURES);
  }

  /** Feature 013 US4: move an archived session back to the active list; Core owns the visibility decision. */
  async unarchiveSession(identity: CanonicalGatewayIdentity, sessionId: string, input: ReadInput): Promise<GatewayBackendReadResponse> {
    if (!isNonBlankString(sessionId) || !isReadInput(input)) throw new BackendUnavailableError();
    return this.fetchRead(identity, 'unarchive-session', sessionId, undefined, input, SESSION_READ_FAILURES);
  }

  /** Feature 013 US4: delete one of the actor's sessions (hidden for good, retained for audit). */
  async deleteSession(identity: CanonicalGatewayIdentity, sessionId: string, input: ReadInput): Promise<GatewayBackendReadResponse> {
    if (!isNonBlankString(sessionId) || !isReadInput(input)) throw new BackendUnavailableError();
    return this.fetchRead(identity, 'delete-session', sessionId, undefined, input, SESSION_READ_FAILURES);
  }

  /** Feature 013 US4: archive one of the actor's own sessions; Core owns the visibility decision. */
  async archiveSession(identity: CanonicalGatewayIdentity, sessionId: string, input: ReadInput): Promise<GatewayBackendReadResponse> {
    if (!isNonBlankString(sessionId) || !isReadInput(input)) throw new BackendUnavailableError();
    return this.fetchRead(identity, 'archive-session', sessionId, undefined, input, SESSION_READ_FAILURES);
  }

  /** Feedback on one Assistant answer; Core checks that the message belongs to the actor's Customer. */
  async submitFeedback(identity: CanonicalGatewayIdentity, messageId: string, feedback: GatewayFeedbackInput, input: ReadInput): Promise<GatewayBackendReadResponse> {
    if (!isNonBlankString(messageId) || !isGatewayFeedbackInput(feedback) || !isReadInput(input)) throw new BackendUnavailableError();
    return this.fetchRead(identity, 'submit-feedback', messageId, undefined, input, FEEDBACK_FAILURES, toGatewayFeedbackInput(feedback));
  }

  async sendStreamMessage(
    identity: CanonicalGatewayIdentity,
    sessionId: string,
    input: SendStreamMessageInput
  ): Promise<ReadableStream<Uint8Array>> {
    if (!isNonBlankString(sessionId) || !isSendStreamMessageInput(input)) throw new BackendUnavailableError();

    const token = await this.dependencies.internalTokenIssuer.issue(identity);
    const route = BACKEND_ROUTE_DEFINITIONS['send-stream-message'];
    const path = route.path.replace(':id', encodeURIComponent(sessionId));
    const abortController = this.dependencies.createAbortController();
    const headers = {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'text/event-stream',
      ...correlationHeader('x-request-id', input.requestId),
      ...correlationHeader('traceparent', input.traceparent)
    };
    const body = JSON.stringify({ message: input.message, choiceId: input.choiceId, pageContext: input.pageContext });

    try {
      const response = await this.dependencies.fetch(new URL(path, this.dependencies.backendBaseUrl).toString(), {
        method: route.method,
        headers,
        body,
        signal: abortController.signal
      });
      if (!response.ok && typeof response.json === 'function') {
        const failure: unknown = await response.json();
        if (isSafeBackendReadFailure(response.status, failure, MESSAGE_REJECTIONS)) throw new BackendMessageRejectedError(response.status, failure);
      }
      if (!response.ok || !isReadableSseBody(response.body)) throw new BackendUnavailableError();
      return forwardSseStream(response.body, abortController);
    } catch (error) {
      if (error instanceof BackendMessageRejectedError) throw error;
      throw new BackendUnavailableError();
    }
  }

  private async fetchRead(
    identity: CanonicalGatewayIdentity,
    operation: ReadOperation,
    resourceId: string | undefined,
    query: Readonly<{ limit?: string; cursor?: string; order?: string; status?: string }> | undefined,
    input: ReadInput,
    safeFailureStatuses: readonly number[],
    requestBody?: Readonly<Record<string, unknown>>
  ): Promise<GatewayBackendReadResponse> {
    const token = await this.dependencies.internalTokenIssuer.issue(identity);
    const route = BACKEND_ROUTE_DEFINITIONS[operation];
    // The one path parameter of the fixed route (`:id` or `:messageId`).
    const path = resourceId === undefined ? route.path : route.path.replace(/:[A-Za-z]+/, encodeURIComponent(resourceId));
    const url = new URL(path, this.dependencies.backendBaseUrl);
    if (query) {
      if (query.limit !== undefined) url.searchParams.set('limit', query.limit);
      if (query.cursor !== undefined) url.searchParams.set('cursor', query.cursor);
      if (query.order !== undefined) url.searchParams.set('order', query.order);
      if (query.status !== undefined) url.searchParams.set('status', query.status);
    }
    try {
      const response = await this.dependencies.fetch(url.toString(), {
        method: route.method,
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/json',
          ...(requestBody === undefined ? {} : { 'content-type': 'application/json' }),
          ...correlationHeader('x-request-id', input.requestId),
          ...correlationHeader('traceparent', input.traceparent)
        },
        ...(requestBody === undefined ? {} : { body: JSON.stringify(requestBody) }),
        signal: this.dependencies.createTimeoutSignal(this.dependencies.timeoutMilliseconds)
      });
      if (typeof response.json !== 'function') throw new BackendUnavailableError();
      const body = await response.json();
      if (response.ok && response.status >= 200 && response.status < 300) return Object.freeze({ statusCode: response.status, body });
      if (isSafeBackendReadFailure(response.status, body, safeFailureStatuses)) return Object.freeze({ statusCode: response.status, body });
      throw new BackendUnavailableError();
    } catch {
      throw new BackendUnavailableError();
    }
  }
}

/**
 * Feature 016: Core refused the message before any SSE output for a reason the client can act on (an experience
 * choice that no longer exists, 409). The Backend's JSON error is passed through instead of BACKEND_UNAVAILABLE.
 */
export class BackendMessageRejectedError extends Error {
  readonly code = 'BACKEND_MESSAGE_REJECTED';

  constructor(readonly statusCode: number, readonly body: unknown) {
    super('Backend rejected the message.');
  }
}

class BackendUnavailableError extends Error {
  readonly statusCode = 503;
  readonly code = 'BACKEND_UNAVAILABLE';

  constructor() {
    super('Backend is unavailable.');
  }
}

function isCreateSessionInput(value: unknown): value is CreateSessionInput {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  if (keys.some((key) => key !== 'pageContext' && key !== 'requestId' && key !== 'traceparent')) return false;
  if (value.pageContext !== undefined && !isRecord(value.pageContext)) return false;
  return isOptionalString(value.requestId) && isOptionalString(value.traceparent);
}

function isSendStreamMessageInput(value: unknown): value is SendStreamMessageInput {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  if (keys.some((key) => key !== 'message' && key !== 'choiceId' && key !== 'pageContext' && key !== 'requestId' && key !== 'traceparent')) return false;
  if (!hasMessageOrChoiceId(value)) return false;
  if (value.pageContext !== undefined && !isRecord(value.pageContext)) return false;
  return isOptionalString(value.requestId) && isOptionalString(value.traceparent);
}

function isReadInput(value: unknown): value is ReadInput {
  return isRecord(value) && Object.keys(value).every((key) => key === 'requestId' || key === 'traceparent')
    && isNonBlankString(value.requestId) && isOptionalString(value.traceparent);
}

function isHistoryQuery(value: unknown): value is GatewayHistoryQuery {
  if (!isRecord(value) || Object.keys(value).some((key) => key !== 'limit' && key !== 'cursor' && key !== 'order')) return false;
  return (value.limit === undefined || (typeof value.limit === 'string' && /^[0-9]+$/.test(value.limit)))
    && isOptionalString(value.cursor)
    && (value.order === undefined || value.order === 'asc');
}

function isSessionListQuery(value: unknown): value is GatewaySessionListQuery {
  if (!isRecord(value) || Object.keys(value).some((key) => key !== 'limit' && key !== 'cursor' && key !== 'status')) return false;
  return (value.limit === undefined || (typeof value.limit === 'string' && GATEWAY_SESSION_LIST_LIMIT_PATTERN.test(value.limit)))
    && (value.cursor === undefined || (typeof value.cursor === 'string' && GATEWAY_SESSION_LIST_CURSOR_PATTERN.test(value.cursor)))
    && (value.status === undefined || value.status === 'archived');
}

const SESSION_READ_FAILURES: readonly number[] = Object.freeze([401, 403, 404]);
const SESSION_LIST_FAILURES: readonly number[] = Object.freeze([400, 401, 403]);
/** Feedback: invalid input or not an answer (400), identity (401/403), message not found for this Customer (404). */
const FEEDBACK_FAILURES: readonly number[] = Object.freeze([400, 401, 403, 404]);
/** Send message: the choice is no longer offered (409 EXPERIENCE_CHOICE_UNAVAILABLE, Feature 016). */
const MESSAGE_REJECTIONS: readonly number[] = Object.freeze([409]);

function isSafeBackendReadFailure(statusCode: number, body: unknown, allowedStatuses: readonly number[]): boolean {
  if (!allowedStatuses.includes(statusCode) || !isRecord(body) || !isNonBlankString(body.requestId) || !isRecord(body.error)) return false;
  return isNonBlankString(body.error.code) && typeof body.error.message === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isReadableSseBody(value: unknown): value is ReadableStream<Uint8Array> {
  return typeof value === 'object' && value !== null && 'getReader' in value && typeof value.getReader === 'function';
}

function forwardSseStream(source: ReadableStream<Uint8Array>, abortController: AbortController): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await reader.read();
        if (next.done) controller.close();
        else controller.enqueue(next.value);
      } catch {
        abortController.abort();
        try {
          await reader.cancel();
        } catch {
          // Source cleanup diagnostics are never consumer-visible.
        }
        controller.error(new BackendUnavailableError());
      }
    },
    async cancel(reason) {
      abortController.abort();
      try {
        await reader.cancel(reason);
      } catch {
        // Consumer cancellation must not leak a source-stream diagnostic.
      }
    }
  });
}

function correlationHeader(name: 'x-request-id' | 'traceparent', value: string | undefined): Record<string, string> {
  return value === undefined ? {} : { [name]: value };
}
