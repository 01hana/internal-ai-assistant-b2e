import { EventEmitter } from 'node:events';
import { createServer, request as nativeHttpsRequest } from 'node:https';
import { appliedCredentialRequest } from '../../src/credentials/credential.types';
import { SafeUpstreamHttpClient, UpstreamResponseCancelledError } from '../../src/upstream/safe-upstream-http-client';
import { createEphemeralTlsTestFixture, type EphemeralTlsTestFixture } from '../fixtures/ephemeral-tls-test-fixture';

describe('Phase 6 one-shot safe HTTPS shell', () => {
  let tlsFixture: EphemeralTlsTestFixture;

  beforeAll(async () => { tlsFixture = await createEphemeralTlsTestFixture(); });
  afterAll(async () => { await tlsFixture.dispose(); });

  const request = Object.freeze({
    service: Object.freeze({ upstreamServiceRef: 'inventory-api', origin: 'https://inventory.test:8443', basePath: '/v1', addressMode: 'public_only' as const, allowedCidrs: Object.freeze([]), hostname: 'inventory.test', port: 8443 }),
    method: 'POST' as const, path: '/v1/stock', body: '{"sku":"SKU-1"}'
  });

  it('uses pinned TLS options, fixed content headers, and one request only', async () => {
    const calls: unknown[] = [];
    const transport = jest.fn((options: object, callback: (response: any) => void) => {
      calls.push(options); const outgoing = new EventEmitter() as any;
      outgoing.write = jest.fn(); outgoing.end = () => callback(Object.assign(new EventEmitter(), { statusCode: 200, headers: { 'content-type': 'application/json' }, [Symbol.asyncIterator]: async function* () { yield Buffer.from('{}'); } }));
      outgoing.destroy = jest.fn(); return outgoing;
    });
    const client = new SafeUpstreamHttpClient(transport as never);
    const lookup = (_host: string, _options: object, cb: Function) => cb(null, '93.184.216.34', 4);
    const result = await client.execute(request, appliedCredentialRequest({ request: request, 'X-Inventory-Key': 'secret' }), lookup, new AbortController().signal);
    expect(result.ok).toBe(true);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(calls[0]).toEqual(expect.objectContaining({ protocol: 'https:', hostname: 'inventory.test', port: 8443, rejectUnauthorized: true, agent: false, servername: 'inventory.test', lookup, headers: expect.objectContaining({ Accept: 'application/json', 'Accept-Encoding': 'identity', 'X-Inventory-Key': 'secret' }) }));
  });

  it.each([301, 302, 307, 308])('denies redirect %s without retry', async (statusCode) => {
    const transport = jest.fn((_options, callback) => {
      const outgoing = new EventEmitter() as any; outgoing.write = jest.fn(); outgoing.destroy = jest.fn();
      outgoing.end = () => callback(Object.assign(new EventEmitter(), { statusCode, headers: { location: 'https://other.test' }, [Symbol.asyncIterator]: async function* () {} })); return outgoing;
    });
    const result = await new SafeUpstreamHttpClient(transport as never).execute(request, appliedCredentialRequest({ request }), jest.fn() as never, new AbortController().signal);
    expect(result).toEqual({ ok: false, code: 'CONNECTOR_DESTINATION_REJECTED' });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('denies encoded responses', async () => {
    const transport = jest.fn((_options, callback) => { const outgoing = new EventEmitter() as any; outgoing.write = jest.fn(); outgoing.destroy = jest.fn(); outgoing.end = () => callback(Object.assign(new EventEmitter(), { statusCode: 200, headers: { 'content-encoding': 'gzip' }, [Symbol.asyncIterator]: async function* () {} })); return outgoing; });
    expect(await new SafeUpstreamHttpClient(transport as never).execute(request, appliedCredentialRequest({ request }), jest.fn() as never, new AbortController().signal)).toEqual({ ok: false, code: 'CONNECTOR_DESTINATION_REJECTED' });
  });
  it('classifies certificate failure as destination rejection and never retries or consumes proxy configuration', async () => {
    const previous = process.env.HTTPS_PROXY; process.env.HTTPS_PROXY = 'http://proxy.invalid:8080';
    const transport = jest.fn((_options: object) => { const outgoing = new EventEmitter() as any; outgoing.write = jest.fn(); outgoing.end = () => outgoing.emit('error', Object.assign(new Error('certificate-sentinel'), { code: 'CERT_HAS_EXPIRED' })); outgoing.destroy = jest.fn(); return outgoing; });
    try {
      expect(await new SafeUpstreamHttpClient(transport as never).execute(request, appliedCredentialRequest({ request }), jest.fn() as never, new AbortController().signal)).toEqual({ ok: false, code: 'CONNECTOR_DESTINATION_REJECTED' });
      expect(transport).toHaveBeenCalledTimes(1);
      expect(transport.mock.calls[0]?.[0]).not.toHaveProperty('proxy');
    } finally { if (previous === undefined) delete process.env.HTTPS_PROXY; else process.env.HTTPS_PROXY = previous; }
  });

  it('uses native TLS hostname verification with a pinned deterministic loopback fixture', async () => {
    const server = createServer({ cert: tlsFixture.certificate, key: tlsFixture.privateKey }, (_request, response) => {
      response.writeHead(200, { 'Content-Type': 'application/json' }); response.end('{}');
    });
    await new Promise<void>((resolve, reject) => server.listen(0, '127.0.0.1', () => resolve()).once('error', reject));
    try {
      const address = server.address(); if (!address || typeof address === 'string') throw new Error('fixture');
      const fixed = { ...request, service: { ...request.service, hostname: 'phase6-upstream.test', port: address.port } };
      const factory = ((options: object, callback: (response: unknown) => void) => nativeHttpsRequest({ ...options, ca: tlsFixture.certificate }, callback as never)) as never;
      const lookup = (_host: string, options: { all?: boolean }, callback: Function) => options.all
        ? callback(null, [{ address: '127.0.0.1', family: 4 }]) : callback(null, '127.0.0.1', 4);
      const result = await new SafeUpstreamHttpClient(factory).execute(fixed, appliedCredentialRequest({ request }), lookup as never, new AbortController().signal);
      expect(result.ok).toBe(true);
      if (result.ok) for await (const _chunk of result.value.body) { /* consume bounded fixture */ }
      const wrong = { ...fixed, service: { ...fixed.service, hostname: 'wrong-host.test' } };
      expect(await new SafeUpstreamHttpClient(factory).execute(wrong, appliedCredentialRequest({ request }), lookup as never, new AbortController().signal)).toEqual({ ok: false, code: 'CONNECTOR_DESTINATION_REJECTED' });
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  });

  it('destroys an accepted response and raises typed cancellation while its body is streaming', async () => {
    const responseDestroy = jest.fn();
    const response = Object.assign(new EventEmitter(), {
      statusCode: 200, headers: { 'content-type': 'application/json' }, destroy: responseDestroy,
      [Symbol.asyncIterator]: async function* () {
        yield Buffer.from('{"partial":');
        await new Promise<void>((resolve) => setImmediate(resolve));
        yield Buffer.from('true}');
      }
    });
    const transport = jest.fn((_options, callback) => {
      const outgoing = new EventEmitter() as any;
      outgoing.write = jest.fn(); outgoing.destroy = jest.fn(); outgoing.end = () => callback(response);
      return outgoing;
    });
    const abort = new AbortController();
    const result = await new SafeUpstreamHttpClient(transport as never).execute(
      request, appliedCredentialRequest({ request }), jest.fn() as never, abort.signal
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const iterator = result.value.body[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toMatchObject({ done: false });
    abort.abort();
    await expect(iterator.next()).rejects.toBeInstanceOf(UpstreamResponseCancelledError);
    expect(responseDestroy).toHaveBeenCalled();
  });
});
