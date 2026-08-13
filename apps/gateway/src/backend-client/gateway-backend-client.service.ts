import type { CanonicalGatewayIdentity } from '../identity/canonical-gateway-identity';
import { BACKEND_ROUTE_DEFINITIONS } from './backend-route-definition';

type CreateSessionInput = Readonly<{
  pageContext?: Readonly<Record<string, unknown>>;
  requestId?: string;
  traceparent?: string;
}>;

type SendStreamMessageInput = Readonly<{
  message: string;
  pageContext?: Readonly<Record<string, unknown>>;
  requestId?: string;
  traceparent?: string;
}>;

export type GatewayHistoryQuery = Readonly<{
  limit?: string;
  cursor?: string;
  order?: 'asc';
}>;

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
    method: 'GET' | 'POST';
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
    return this.fetchRead(identity, 'get-session', sessionId, undefined, input);
  }

  async getSessionMessages(identity: CanonicalGatewayIdentity, sessionId: string, query: GatewayHistoryQuery, input: ReadInput): Promise<GatewayBackendReadResponse> {
    if (!isNonBlankString(sessionId) || !isHistoryQuery(query) || !isReadInput(input)) throw new BackendUnavailableError();
    return this.fetchRead(identity, 'get-session-messages', sessionId, query, input);
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
    const body = JSON.stringify({ message: input.message, pageContext: input.pageContext });

    try {
      const response = await this.dependencies.fetch(new URL(path, this.dependencies.backendBaseUrl).toString(), {
        method: route.method,
        headers,
        body,
        signal: abortController.signal
      });
      if (!response.ok || !isReadableSseBody(response.body)) throw new BackendUnavailableError();
      return forwardSseStream(response.body, abortController);
    } catch {
      throw new BackendUnavailableError();
    }
  }

  private async fetchRead(
    identity: CanonicalGatewayIdentity,
    operation: 'get-session' | 'get-session-messages',
    sessionId: string,
    query: GatewayHistoryQuery | undefined,
    input: ReadInput
  ): Promise<GatewayBackendReadResponse> {
    const token = await this.dependencies.internalTokenIssuer.issue(identity);
    const route = BACKEND_ROUTE_DEFINITIONS[operation];
    const url = new URL(route.path.replace(':id', encodeURIComponent(sessionId)), this.dependencies.backendBaseUrl);
    if (query) {
      if (query.limit !== undefined) url.searchParams.set('limit', query.limit);
      if (query.cursor !== undefined) url.searchParams.set('cursor', query.cursor);
      if (query.order !== undefined) url.searchParams.set('order', query.order);
    }
    try {
      const response = await this.dependencies.fetch(url.toString(), {
        method: route.method,
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/json',
          ...correlationHeader('x-request-id', input.requestId),
          ...correlationHeader('traceparent', input.traceparent)
        },
        signal: this.dependencies.createTimeoutSignal(this.dependencies.timeoutMilliseconds)
      });
      if (typeof response.json !== 'function') throw new BackendUnavailableError();
      const body = await response.json();
      if (response.ok && response.status >= 200 && response.status < 300) return Object.freeze({ statusCode: response.status, body });
      if (isSafeBackendReadFailure(response.status, body)) return Object.freeze({ statusCode: response.status, body });
      throw new BackendUnavailableError();
    } catch {
      throw new BackendUnavailableError();
    }
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
  if (keys.some((key) => key !== 'message' && key !== 'pageContext' && key !== 'requestId' && key !== 'traceparent')) return false;
  if (!isNonBlankString(value.message)) return false;
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

function isSafeBackendReadFailure(statusCode: number, body: unknown): boolean {
  if (![401, 403, 404].includes(statusCode) || !isRecord(body) || !isNonBlankString(body.requestId) || !isRecord(body.error)) return false;
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
