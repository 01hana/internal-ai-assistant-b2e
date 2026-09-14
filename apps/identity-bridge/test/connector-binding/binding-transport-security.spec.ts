import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { BridgeConfigService } from '../../src/config/bridge-config.service';
import { ConnectorBindingClient } from '../../src/connector-binding/connector-binding.client';
import { ConnectorBindingDestinationPolicy } from '../../src/connector-binding/connector-binding-destination.policy';
import { bindingEnvironment } from './binding-fixtures';

const requestId = randomUUID();
const signed = Object.freeze({ bytes: Buffer.from('{"version":"1"}'), proof: 'signed-service-proof', requestId });
const failureEnvelope = { version: '1', requestId, status: 'failed', error: { code: 'CONNECTOR_BINDING_INVALID' } };

describe('BRIDGE_BINDING_TRANSPORT_V1 attack handling', () => {
  it.each([
    ['169.254.169.254', 'public_only', []], ['fd00:ec2::254', 'allowlisted_networks', ['fc00::/7']],
    ['10.2.3.4', 'public_only', []], ['::ffff:127.0.0.1', 'public_only', []]
  ])('rejects unsafe destination %s under %s', (address, mode, allowedCidrs) => {
    const policy = new ConnectorBindingDestinationPolicy({ mode: mode as never, allowedCidrs });
    expect(policy.validate([address])).toEqual({ ok: false, code: 'CONNECTOR_DESTINATION_REJECTED' });
  });

  it('validates every DNS answer and never falls back from a mixed set', () => {
    const policy = new ConnectorBindingDestinationPolicy({ mode: 'allowlisted_networks', allowedCidrs: ['10.0.0.0/8'] });
    expect(policy.validate(['10.2.3.4', '8.8.8.8'])).toEqual({ ok: false, code: 'CONNECTOR_DESTINATION_REJECTED' });
    expect(policy.validate(['::ffff:10.2.3.4'])).toEqual({ ok: true, value: ['10.2.3.4'] });
  });

  it.each([
    ['redirect', 302, { 'content-type': 'application/json', location: 'https://other.test/' }, failureEnvelope, 'CONNECTOR_DESTINATION_REJECTED'],
    ['compression', 200, { 'content-type': 'application/json', 'content-encoding': 'gzip' }, failureEnvelope, 'CONNECTOR_DESTINATION_REJECTED'],
    ['non-json', 200, { 'content-type': 'text/plain' }, failureEnvelope, 'CONNECTOR_DESTINATION_REJECTED'],
    ['uncorrelated', 200, { 'content-type': 'application/json' }, { ...failureEnvelope, requestId: 'other-request' }, 'CONNECTOR_RESPONSE_INVALID'],
    ['invalid-status', 600, { 'content-type': 'application/json' }, failureEnvelope, 'CONNECTOR_UPSTREAM_FAILED']
  ])('fails closed for %s and performs one request', async (_name, status, headers, body, code) => {
    const io = responseFactory(body, status, headers);
    const client = clientWith(io.factory);
    await expect(client.exchange(signed)).resolves.toEqual({ ok: false, code });
    expect(io.calls).toHaveLength(1);
  });

  it('rejects an oversized and malformed response without accepting a partial reference', async () => {
    const oversize = responseFactory('x'.repeat(4_097));
    await expect(clientWith(oversize.factory).exchange(signed)).resolves.toEqual({ ok: false, code: 'CONNECTOR_RESPONSE_INVALID' });
    const malformed = responseFactory('{"version":"1"');
    await expect(clientWith(malformed.factory).exchange(signed)).resolves.toEqual({ ok: false, code: 'CONNECTOR_RESPONSE_INVALID' });
  });

  it('aborts hanging DNS and ignores a late answer without sending a bearer', async () => {
    let complete: ((value: readonly { address: string; family: number }[]) => void) | undefined;
    const resolver = jest.fn(() => new Promise<readonly { address: string; family: number }[]>((resolve) => { complete = resolve; }));
    const requestFactory = jest.fn();
    const client = new ConnectorBindingClient(new BridgeConfigService(bindingEnvironment()), { resolver, requestFactory: requestFactory as never });
    const abort = new AbortController();
    const pending = client.exchange(signed, abort.signal);
    abort.abort();
    await expect(pending).resolves.toEqual({ ok: false, code: 'CONNECTOR_TIMEOUT' });
    complete?.([{ address: '8.8.8.8', family: 4 }]);
    await Promise.resolve();
    expect(requestFactory).not.toHaveBeenCalled();
  });

  it('destroys the only pending request and active response on cancellation with no retry', async () => {
    const response = Object.assign(new EventEmitter(), { statusCode: 200, headers: { 'content-type': 'application/json' }, destroy: jest.fn() });
    const outgoing = Object.assign(new EventEmitter(), { end: jest.fn(), destroy: jest.fn() });
    let markCreated: (() => void) | undefined;
    const created = new Promise<void>((resolve) => { markCreated = resolve; });
    const factory = jest.fn((_options, callback: (incoming: never) => void) => {
      outgoing.end.mockImplementation(() => { callback(response as never); response.emit('data', Buffer.from('{"version":"1"')); });
      markCreated?.();
      return outgoing;
    });
    const abort = new AbortController();
    const pending = clientWith(factory as never).exchange(signed, abort.signal);
    await created;
    abort.abort();
    await expect(pending).resolves.toEqual({ ok: false, code: 'CONNECTOR_TIMEOUT' });
    expect(factory).toHaveBeenCalledTimes(1);
    expect(outgoing.destroy).toHaveBeenCalledTimes(1);
    expect(response.destroy).toHaveBeenCalledTimes(1);
  });

  it('ignores proxy environment and fixes TLS, hostname, route, and identity encoding', async () => {
    const previous = process.env.HTTPS_PROXY;
    process.env.HTTPS_PROXY = 'http://proxy-sentinel.invalid';
    const io = responseFactory(failureEnvelope, 503);
    try {
      await clientWith(io.factory).exchange(signed);
      expect(io.calls[0]).toMatchObject({
        protocol: 'https:', hostname: 'connector-runtime.test', path: '/v1/internal/connector-bindings',
        rejectUnauthorized: true, servername: 'connector-runtime.test', agent: false,
        headers: expect.objectContaining({ 'accept-encoding': 'identity', authorization: 'Bearer signed-service-proof' })
      });
      expect(JSON.stringify(io.calls[0])).not.toContain('proxy-sentinel');
    } finally {
      if (previous === undefined) delete process.env.HTTPS_PROXY;
      else process.env.HTTPS_PROXY = previous;
    }
  });
});

function clientWith(requestFactory: never): ConnectorBindingClient {
  return new ConnectorBindingClient(new BridgeConfigService(bindingEnvironment()), {
    resolver: async () => [{ address: '8.8.8.8', family: 4 }], requestFactory
  });
}

function responseFactory(body: unknown, statusCode = 200, headers: Record<string, string> = { 'content-type': 'application/json' }) {
  const calls: Record<string, unknown>[] = [];
  const factory = (options: Record<string, unknown>, callback: (response: never) => void) => {
    calls.push(options);
    const response = Object.assign(new EventEmitter(), { statusCode, headers, destroy: jest.fn() });
    const request = Object.assign(new EventEmitter(), {
      destroy: jest.fn(),
      end: jest.fn(() => {
        callback(response as never);
        queueMicrotask(() => {
          response.emit('data', Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)));
          response.emit('end');
        });
      })
    });
    return request;
  };
  return { factory: factory as never, calls };
}
