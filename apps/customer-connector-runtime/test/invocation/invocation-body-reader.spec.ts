import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { readBoundedInvocationBody } from '../../src/invocation/invocation-body.reader';
import { ConnectorInvocationController } from '../../src/invocation/connector-invocation.controller';
import { CONNECTOR_INVOCATION_MAX_REQUEST_BYTES } from '@internal-ai-assistant/connector-runtime-contract';

describe('Phase 6 fail-fast invocation body intake', () => {
  it('rejects an oversized declared content length without reading a byte', async () => {
    let reads = 0;
    const request = new Readable({ read() { reads += 1; this.push(Buffer.from('{}')); this.push(null); } });
    const result = await readBoundedInvocationBody(request, 16, '17');
    expect(result).toEqual({ ok: false, code: 'CONNECTOR_REQUEST_INVALID' });
    expect(reads).toBe(0);
  });

  it('stops intake as soon as a chunk crosses the byte limit without waiting for EOF', async () => {
    const request = Object.assign(new EventEmitter(), { pause: jest.fn() });
    const pending = readBoundedInvocationBody(request as unknown as Readable, 16);
    request.emit('data', Buffer.alloc(17, 0x61));
    const result = await pending;
    expect(result).toEqual({ ok: false, code: 'CONNECTOR_REQUEST_INVALID' });
    expect(request.pause).toHaveBeenCalledTimes(1);
    expect(request.listenerCount('data')).toBe(0);
    expect(request.listenerCount('end')).toBe(0);
  });

  it('preserves the exact bytes of an accepted body', async () => {
    const request = Readable.from([Buffer.from('{"a":'), Buffer.from('1}')]);
    const result = await readBoundedInvocationBody(request, 16, '7');
    expect(result).toEqual({ ok: true, value: Buffer.from('{"a":1}') });
  });

  it('returns a safe envelope and never enters invocation orchestration for oversized transport', async () => {
    const handle = jest.fn();
    const controller = new ConnectorInvocationController({ handle } as never);
    const request = Object.assign(new EventEmitter(), {
      method: 'POST',
      headers: { 'content-length': String(CONNECTOR_INVOCATION_MAX_REQUEST_BYTES + 1) },
      pause: jest.fn(),
      socket: { destroy: jest.fn() }
    });
    const response = Object.assign(new EventEmitter(), {
      setHeader: jest.fn(),
      status: jest.fn(),
      type: jest.fn(),
      send: jest.fn()
    });
    response.status.mockReturnValue(response);
    response.type.mockReturnValue(response);
    response.send.mockImplementation(() => { response.emit('finish'); return response; });

    await controller.invoke(request as never, response as never);

    expect(handle).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.send).toHaveBeenCalledWith({
      version: '1', requestId: 'rejected-request', status: 'failed',
      error: { code: 'CONNECTOR_REQUEST_INVALID' }
    });
    expect(request.pause).toHaveBeenCalled();
    expect(request.socket.destroy).toHaveBeenCalled();
  });

  it('stops a chunked oversized route before proof, replay, binding, credential, or upstream orchestration', async () => {
    const handle = jest.fn();
    const controller = new ConnectorInvocationController({ handle } as never);
    const request = Object.assign(new EventEmitter(), {
      method: 'POST', headers: {}, pause: jest.fn(), socket: { destroy: jest.fn() }
    });
    const response = Object.assign(new EventEmitter(), {
      setHeader: jest.fn(), status: jest.fn(), type: jest.fn(), send: jest.fn()
    });
    response.status.mockReturnValue(response);
    response.type.mockReturnValue(response);
    response.send.mockImplementation(() => { response.emit('finish'); return response; });
    const pending = controller.invoke(request as never, response as never);
    request.emit('data', Buffer.alloc(CONNECTOR_INVOCATION_MAX_REQUEST_BYTES + 1, 0x61));
    await pending;
    expect(handle).not.toHaveBeenCalled();
    expect(request.pause).toHaveBeenCalledTimes(1);
    expect(response.send).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed', error: { code: 'CONNECTOR_REQUEST_INVALID' }
    }));
  });

  it('aborts the controller-owned signal when the client connection closes after complete body intake', async () => {
    let observedSignal: AbortSignal | undefined;
    const handle = jest.fn((input: { requestSignal?: AbortSignal }) => {
      observedSignal = input.requestSignal;
      return new Promise((resolve) => input.requestSignal?.addEventListener('abort', () => resolve({
        statusCode: 504, body: { version: '1', requestId: 'request-close', status: 'failed', error: { code: 'CONNECTOR_TIMEOUT' } }
      }), { once: true }));
    });
    const controller = new ConnectorInvocationController({ handle } as never, { nowMilliseconds: () => 0 });
    const request = routeRequest(Buffer.from('{}'));
    const response = routeResponse();
    const pending = controller.invoke(request as never, response as never);
    request.emit('data', Buffer.from('{}'));
    request.emit('end');
    await until(() => handle.mock.calls.length === 1);
    response.emit('close');
    await pending;
    expect(observedSignal?.aborted).toBe(true);
    expect(response.send).toHaveBeenCalledWith(expect.objectContaining({ error: { code: 'CONNECTOR_TIMEOUT' } }));
    expect(request.listenerCount('aborted')).toBe(0);
    expect(response.listenerCount('close')).toBe(0);
  });

  it('does not abort after a normal response finishes and cleans up lifecycle listeners', async () => {
    let observedSignal: AbortSignal | undefined;
    const handle = jest.fn(async (input: { requestSignal?: AbortSignal }) => {
      observedSignal = input.requestSignal;
      return { statusCode: 200, body: { version: '1', requestId: 'request-success', status: 'succeeded', result: { count: 1 } } };
    });
    const controller = new ConnectorInvocationController({ handle } as never, { nowMilliseconds: () => 0 });
    const request = routeRequest(Buffer.from('{}'));
    const response = routeResponse(true);
    const pending = controller.invoke(request as never, response as never);
    request.emit('data', Buffer.from('{}'));
    request.emit('end');
    await pending;
    expect(observedSignal?.aborted).toBe(false);
    expect(request.listenerCount('aborted')).toBe(0);
    expect(response.listenerCount('close')).toBe(0);
  });
});

function routeRequest(body: Buffer) {
  return Object.assign(new EventEmitter(), {
    method: 'POST', pause: jest.fn(), socket: { destroy: jest.fn() },
    headers: { 'content-type': 'application/json', 'content-length': String(body.byteLength) }
  });
}

function routeResponse(closeAfterFinish = false) {
  const response = Object.assign(new EventEmitter(), {
    writableFinished: false,
    setHeader: jest.fn(), status: jest.fn(), type: jest.fn(), send: jest.fn()
  });
  response.status.mockReturnValue(response);
  response.type.mockReturnValue(response);
  response.send.mockImplementation(() => {
    response.writableFinished = true;
    response.emit('finish');
    if (closeAfterFinish) response.emit('close');
    return response;
  });
  return response;
}

async function until(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50 && !condition(); attempt += 1) await Promise.resolve();
  if (!condition()) throw new Error('expected controller stage was not reached');
}
