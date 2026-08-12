import { EventEmitter } from 'node:events';
import { HttpException } from '@nestjs/common';
import type { Response } from 'express';
import { GatewayAssistantController } from '../../src/operations/gateway-assistant.controller';
import type { GatewayTrustChainHandler } from '../../src/backend-client/gateway-trust-chain.handler';
import { IdentityServiceUnavailableError } from '../../src/signing/identity-service-unavailable.error';

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

class TestResponse extends EventEmitter {
  readonly writes: string[] = [];
  writableEnded = false;
  ended = false;

  status(_status: number): this { return this; }
  setHeader(_name: string, _value: string): void { /* test response records body only */ }
  write(chunk: Buffer): void { this.writes.push(chunk.toString('utf8')); }
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
