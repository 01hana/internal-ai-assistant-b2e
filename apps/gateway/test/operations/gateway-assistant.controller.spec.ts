import { EventEmitter } from 'node:events';
import { HttpException } from '@nestjs/common';
import type { Response } from 'express';
import { GatewayAssistantController } from '../../src/operations/gateway-assistant.controller';
import type { GatewayTrustChainHandler } from '../../src/backend-client/gateway-trust-chain.handler';
import { IdentityServiceUnavailableError } from '../../src/signing/identity-service-unavailable.error';
import { IdentityResolutionError } from '../../src/integration-registry/canonical-identity-resolver.service';
import { MultiProfileInfrastructureError } from '../../src/upstream-auth/multi-profile-upstream-token-verifier';
import { UpstreamAuthenticationError } from '../../src/upstream-auth/upstream-auth.error';

/**
 * These tests cover only the Host-controller stream lifecycle. They use a
 * controlled handler stream and do not replace the real T074 trust-chain,
 * JWKS, CustomerScope, or GatewayBackendClient evidence.
 */
describe('GatewayAssistantController SSE lifecycle', () => {
  it('cancels the source reader and ends without writing later chunks when the Host response closes', async () => {
    const source = createPendingStream();
    const handler = createHandler(source.stream);
    const response = new TestResponse();
    const controller = new GatewayAssistantController(handler);

    const operation = controller.sendStreamMessage(
      'Bearer upstream-token',
      'controller-cancel-request',
      undefined,
      'session-owned-001',
      { message: 'Summarize this order.' },
      response as unknown as Response
    );
    await source.readStarted;
    response.emit('close');
    await operation;

    expect(handler.sendStreamMessage).toHaveBeenCalledTimes(1);
    expect(source.cancelled).toBe(true);
    expect(response.writes).toEqual([]);
    expect(response.ended).toBe(true);
  });

  it('projects a post-response source error as one safe SSE error event without raw diagnostics', async () => {
    const rawDiagnostic = 'controller-stream-error backend-url=https://backend.secret.test Authorization: Bearer internal.jwt.secret';
    const source = createErroredStream();
    const handler = createHandler(source.stream);
    const response = new TestResponse();
    const controller = new GatewayAssistantController(handler);

    const operation = controller.sendStreamMessage(
      'Bearer upstream-token',
      'controller-stream-error-request',
      undefined,
      'session-owned-002',
      { message: 'Summarize this order.' },
      response as unknown as Response
    );
    await source.readStarted;
    source.fail(new Error(rawDiagnostic));
    await operation;

    const output = response.writes.join('');
    expect(output).toBe('event: error\ndata: {"requestId":"controller-stream-error-request","code":"BACKEND_UNAVAILABLE","message":"Backend is unavailable."}\n\n');
    expectNoSensitiveOutput(output, [rawDiagnostic, 'https://backend.secret.test', 'internal.jwt.secret', 'Bearer upstream-token']);
    expect(response.ended).toBe(true);
    expect(handler.sendStreamMessage).toHaveBeenCalledTimes(1);
  });
});

describe('GatewayAssistantController signing-unavailable projection', () => {
  it('projects an unavailable internal signing boundary without diagnostics', async () => {
    const handler = {
      createSession: jest.fn(async () => { throw new IdentityServiceUnavailableError(); })
    } as unknown as GatewayTrustChainHandler;
    const controller = new GatewayAssistantController(handler);

    try {
      await controller.createSession('Bearer upstream-token', 'request-signing-unavailable', undefined, {});
      throw new Error('Expected signing-unavailable projection.');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getResponse()).toEqual({
        statusCode: 503,
        code: 'IDENTITY_SERVICE_UNAVAILABLE',
        message: 'Identity service is unavailable.'
      });
      expect(JSON.stringify((error as HttpException).getResponse())).not.toContain('upstream-token');
    }
  });
});

describe('GatewayAssistantController trust-chain public error taxonomy (T050/T051)', () => {
  const upstreamEnvelope = { statusCode: 401, code: 'UPSTREAM_IDENTITY_INVALID', message: 'Upstream identity is invalid.' };
  const resolverEnvelope = { statusCode: 403, code: 'IDENTITY_ISSUANCE_DENIED', message: 'Identity issuance cannot be completed.' };
  const infrastructureEnvelope = { statusCode: 503, code: 'IDENTITY_SERVICE_UNAVAILABLE', message: 'Identity service is unavailable.' };

  it.each([
    'missing_or_malformed_token', 'invalid_signature', 'invalid_kid', 'issuer_mismatch', 'audience_mismatch', 'invalid_claim_shape'
  ] as const)('maps verifier credential %s to the same generic 401 envelope', async (reason) => {
    const controller = new GatewayAssistantController({ createSession: jest.fn(async () => { throw new UpstreamAuthenticationError(reason); }) } as unknown as GatewayTrustChainHandler);
    await expectHttpError(controller.createSession('Bearer profile-a.secret-token', 'request-401', undefined, {}), upstreamEnvelope, ['profile-a', 'secret-token', reason]);
  });

  it.each(['unknown_binding', 'disabled_binding', 'host_app_mismatch', 'invalid_binding'] as const)('maps resolver denial %s to the same generic 403 envelope', async (reason) => {
    const controller = new GatewayAssistantController({ createSession: jest.fn(async () => { throw new IdentityResolutionError(reason); }) } as unknown as GatewayTrustChainHandler);
    await expectHttpError(controller.createSession('Bearer customer-a.token', 'request-403', undefined, {}), resolverEnvelope, ['customer-a', 'token', reason]);
  });

  it('maps registry, profile/JWKS, and transport infrastructure to one generic 503 envelope across fixed pre-stream operations', async () => {
    const raw = 'profile-a issuer=https://issuer.secret.test/jwks?credential=secret database unavailable';
    const create = new GatewayAssistantController({ createSession: jest.fn(async () => { throw new MultiProfileInfrastructureError(); }) } as unknown as GatewayTrustChainHandler);
    await expectHttpError(create.createSession('Bearer upstream-token', 'request-503-create', undefined, {}), infrastructureEnvelope, [raw, 'profile-a', 'issuer']);

    const read = new GatewayAssistantController({ getSession: jest.fn(async () => { throw new MultiProfileInfrastructureError(); }) } as unknown as GatewayTrustChainHandler);
    await expectHttpError(read.getSession('Bearer upstream-token', 'request-503-read', undefined, 'session-a', {}, undefined, new TestResponse() as unknown as Response), infrastructureEnvelope, ['upstream-token', 'profile-a']);

    const stream = new GatewayAssistantController({ sendStreamMessage: jest.fn(async () => { throw new MultiProfileInfrastructureError(); }) } as unknown as GatewayTrustChainHandler);
    await expectHttpError(stream.sendStreamMessage('Bearer upstream-token', 'request-503-stream', undefined, 'session-a', { message: 'hello' }, new TestResponse() as unknown as Response), infrastructureEnvelope, ['upstream-token', 'profile-a']);
  });

  it('does not project arbitrary programming errors as identity infrastructure', async () => {
    const error = new Error('programming failure profile-a');
    const controller = new GatewayAssistantController({ createSession: jest.fn(async () => { throw error; }) } as unknown as GatewayTrustChainHandler);
    await expect(controller.createSession('Bearer upstream-token', 'request-unclassified', undefined, {})).rejects.toBe(error);
  });

  it('does not publicly distinguish profile, issuer, JWKS, or binding variants within their categories', async () => {
    const authResponses = await Promise.all(['profile-a-missing', 'profile-b-missing', 'unknown-issuer', 'known-issuer-bad-signature'].map(async (_variant) => {
      const controller = new GatewayAssistantController({ createSession: jest.fn(async () => { throw new UpstreamAuthenticationError('invalid_signature'); }) } as unknown as GatewayTrustChainHandler);
      return httpResponse(controller.createSession('Bearer sentinel', 'request-auth-enumeration', undefined, {}));
    }));
    expect(authResponses).toEqual([upstreamEnvelope, upstreamEnvelope, upstreamEnvelope, upstreamEnvelope]);

    const resolverResponses = await Promise.all(['customer-a-missing-binding', 'customer-b-disabled-binding'].map(async (variant) => {
      const reason = variant.includes('missing') ? 'unknown_binding' : 'disabled_binding';
      const controller = new GatewayAssistantController({ createSession: jest.fn(async () => { throw new IdentityResolutionError(reason); }) } as unknown as GatewayTrustChainHandler);
      return httpResponse(controller.createSession('Bearer sentinel', 'request-binding-enumeration', undefined, {}));
    }));
    expect(resolverResponses).toEqual([resolverEnvelope, resolverEnvelope]);

    const infrastructureResponses = await Promise.all(['profile-a-jwks', 'profile-b-jwks'].map(async () => {
      const controller = new GatewayAssistantController({ createSession: jest.fn(async () => { throw new MultiProfileInfrastructureError(); }) } as unknown as GatewayTrustChainHandler);
      return httpResponse(controller.createSession('Bearer sentinel', 'request-jwks-enumeration', undefined, {}));
    }));
    expect(infrastructureResponses).toEqual([infrastructureEnvelope, infrastructureEnvelope]);
  });
});

describe('GatewayAssistantController read/restore input and response boundary', () => {
  it('delegates fixed GET session input and writes only the verified Backend JSON envelope/status', async () => {
    const handler = {
      getSession: jest.fn(async () => ({ statusCode: 200, body: { requestId: 'backend-read', data: { sessionId: 'session-owned-001' } } }))
    } as unknown as GatewayTrustChainHandler;
    const response = new TestResponse();
    const controller = new GatewayAssistantController(handler);

    await controller.getSession('Bearer upstream-token', 'gateway-read-session', undefined, 'session-owned-001', {}, undefined, response as unknown as Response);

    expect(handler.getSession).toHaveBeenCalledWith({ authorization: 'Bearer upstream-token', sessionId: 'session-owned-001', requestId: 'gateway-read-session', traceparent: undefined });
    expect(response.statusCode).toBe(200);
    expect(response.sent).toEqual({ requestId: 'backend-read', data: { sessionId: 'session-owned-001' } });
    expect(JSON.stringify(response.sent)).not.toContain('upstream-token');
  });

  it('rejects unknown history query before trust-chain work', async () => {
    const handler = { getSessionMessages: jest.fn() } as unknown as GatewayTrustChainHandler;
    const controller = new GatewayAssistantController(handler);
    const response = new TestResponse();

    await expect(controller.getSessionMessages('Bearer upstream-token', 'gateway-read-history', undefined, 'session-owned-001', { customerId: 'customer-b' }, undefined, response as unknown as Response)).rejects.toBeInstanceOf(HttpException);
    expect(handler.getSessionMessages).not.toHaveBeenCalled();
  });
});

class TestResponse extends EventEmitter {
  readonly writes: string[] = [];
  writableEnded = false;
  ended = false;
  statusCode: number | undefined;
  sent: unknown;

  status(status: number): this { this.statusCode = status; return this; }
  setHeader(_name: string, _value: string): void { /* test response records body only */ }
  write(chunk: Buffer): void { this.writes.push(chunk.toString('utf8')); }
  send(value: unknown): void { this.sent = value; }
  end(): void { this.writableEnded = true; this.ended = true; }
}

function createHandler(stream: ReadableStream<Uint8Array>): GatewayTrustChainHandler {
  return {
    sendStreamMessage: jest.fn(async () => stream)
  } as unknown as GatewayTrustChainHandler;
}

function createPendingStream(): Readonly<{ stream: ReadableStream<Uint8Array>; readStarted: Promise<void>; readonly cancelled: boolean }> {
  let markReadStarted: (() => void) | undefined;
  let cancelled = false;
  const readStarted = new Promise<void>((resolve) => { markReadStarted = resolve; });
  const stream = new ReadableStream<Uint8Array>({
    pull: () => {
      markReadStarted?.();
      return new Promise<void>(() => undefined);
    },
    cancel: () => { cancelled = true; }
  });
  return Object.freeze({ stream, readStarted, get cancelled() { return cancelled; } });
}

function createErroredStream(): Readonly<{ stream: ReadableStream<Uint8Array>; readStarted: Promise<void>; fail(error: Error): void }> {
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  let markReadStarted: (() => void) | undefined;
  const readStarted = new Promise<void>((resolve) => { markReadStarted = resolve; });
  const stream = new ReadableStream<Uint8Array>({
    start: (nextController) => { controller = nextController; },
    pull: () => { markReadStarted?.(); }
  });
  return Object.freeze({
    stream,
    readStarted,
    fail: (error: Error) => { controller?.error(error); }
  });
}

function expectNoSensitiveOutput(value: string, sentinels: readonly string[]): void {
  expect(sentinels.filter((sentinel) => value.includes(sentinel)).map(() => 'sse-output:secret-category')).toEqual([]);
}

async function expectHttpError(operation: Promise<unknown>, expected: Readonly<Record<string, unknown>>, hidden: readonly string[]): Promise<void> {
  try {
    await operation;
    throw new Error('Expected HTTP projection.');
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    const response = (error as HttpException).getResponse();
    expect(response).toEqual(expected);
    expectNoSensitiveOutput(JSON.stringify(response), hidden);
  }
}

async function httpResponse(operation: Promise<unknown>): Promise<unknown> {
  try {
    await operation;
    throw new Error('Expected HTTP projection.');
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    return (error as HttpException).getResponse();
  }
}
