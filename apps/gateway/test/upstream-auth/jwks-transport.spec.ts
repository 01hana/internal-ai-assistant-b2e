import { createValidatedSocketLookup, HardenedJwksTransport, JwksTransportError } from '../../src/upstream-auth/jwks-transport.adapter';
import type { LookupAddress, LookupOptions } from 'node:dns';
import { readFile } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';

describe('Hardened JWKS transport (T023/T024)', () => {
  describe('Node HTTPS lookup callback compatibility', () => {
    it('returns validated address records when Node requests all results', async () => {
      const callback = jest.fn();
      createValidatedSocketLookup(async () => ['8.8.8.8', '2606:4700:4700::1111'])(
        'issuer.example.test',
        { all: true },
        callback
      );

      await settleLookup();

      expect(callback).toHaveBeenCalledWith(null, [
        { address: '8.8.8.8', family: 4 },
        { address: '2606:4700:4700::1111', family: 6 }
      ]);
    });

    it('returns the first validated address and family for the single-result callback', async () => {
      const callback = jest.fn();
      createValidatedSocketLookup(async () => ['2606:4700:4700::1111', '8.8.8.8'])(
        'issuer.example.test',
        {},
        callback
      );

      await settleLookup();

      expect(callback).toHaveBeenCalledWith(null, '2606:4700:4700::1111', 6);
    });

    it.each([
      [4, [{ address: '8.8.8.8', family: 4 }]],
      [6, [{ address: '2606:4700:4700::1111', family: 6 }]],
      ['IPv4', [{ address: '8.8.8.8', family: 4 }]],
      ['IPv6', [{ address: '2606:4700:4700::1111', family: 6 }]]
    ] as const)('filters all-result records for requested family %s', async (family, expected) => {
      const result = await invokeAllLookup({ all: true, family }, ['2606:4700:4700::1111', '8.8.8.8']);
      expect(result).toEqual(expected);
    });

    it.each([
      [4, '8.8.8.8', 4],
      [6, '2606:4700:4700::1111', 6]
    ] as const)('filters a single result for requested family %s', async (family, expectedAddress, expectedFamily) => {
      const callback = jest.fn();
      createValidatedSocketLookup(async () => ['2606:4700:4700::1111', '8.8.8.8'])(
        'issuer.example.test',
        { family },
        callback
      );

      await settleLookup();

      expect(callback).toHaveBeenCalledWith(null, expectedAddress, expectedFamily);
    });

    it('fails closed when no validated address matches the requested family', async () => {
      const callback = jest.fn();
      createValidatedSocketLookup(async () => ['2606:4700:4700::1111'])(
        'issuer.example.test',
        { family: 4 },
        callback
      );

      await settleLookup();

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback.mock.calls[0][0]).toBeInstanceOf(JwksTransportError);
      expect(callback.mock.calls[0][1]).toBe('');
    });

    it('fails closed before the socket callback receives an invalid or rejected resolution', async () => {
      const rejectedCallback = jest.fn();
      createValidatedSocketLookup(async () => { throw new JwksTransportError(); })(
        'issuer.example.test',
        { all: true },
        rejectedCallback
      );
      const invalidCallback = jest.fn();
      createValidatedSocketLookup(async () => ['not-an-ip'])(
        'issuer.example.test',
        { all: true },
        invalidCallback
      );

      await settleLookup();

      for (const callback of [rejectedCallback, invalidCallback]) {
        expect(callback).toHaveBeenCalledTimes(1);
        expect(callback.mock.calls[0][0]).toBeInstanceOf(JwksTransportError);
        expect(callback.mock.calls[0][1]).toBe('');
      }
    });
  });

  it.each([
    ['redirect', { statusCode: 302, headers: {}, chunks: [] }],
    ['invalid content type', { statusCode: 200, headers: { 'content-type': 'text/html' }, chunks: [Buffer.from('{"keys":[]}')] }],
    ['invalid JWKS', { statusCode: 200, headers: { 'content-type': 'application/json' }, chunks: [Buffer.from('{"keys":[]}')] }],
    ['malformed JSON', { statusCode: 200, headers: { 'content-type': 'application/json' }, chunks: [Buffer.from('{')] }]
  ])('fails closed for %s', async (_label, response) => {
    const transport = fakeTransport(response);
    await expect(transport.fetch('https://issuer.example.test/jwks')).rejects.toBeInstanceOf(JwksTransportError);
  });
  it('rejects response bodies over the hard bound and real connection-time rebinding', async () => {
    await expect(fakeTransport({ statusCode: 200, headers: { 'content-type': 'application/json' }, chunks: [Buffer.alloc(256 * 1024 + 1)] }).fetch('https://issuer.example.test/jwks')).rejects.toThrow();
    const resolve = jest.fn().mockResolvedValueOnce(['8.8.8.8']).mockResolvedValueOnce(['127.0.0.1']);
    const request = jest.fn(async (url, lookupFn) => { await lookupFn(url.hostname); return validResponse(); });
    await expect(new HardenedJwksTransport({ resolve, request }).fetch('https://issuer.example.test/jwks')).rejects.toBeInstanceOf(JwksTransportError);
    expect(resolve).toHaveBeenCalledTimes(2);
  });
  it('rejects mixed initial DNS answers before the HTTPS request receives any address', async () => {
    const request = jest.fn(async () => validResponse());
    const transport = new HardenedJwksTransport({ resolve: async () => ['8.8.8.8', '127.0.0.1'], request });

    await expect(transport.fetch('https://issuer.example.test/jwks')).rejects.toBeInstanceOf(JwksTransportError);

    expect(request).not.toHaveBeenCalled();
  });
  it('accepts a public-to-public connection-time lookup', async () => {
    const resolve = jest.fn().mockResolvedValue(['8.8.8.8']);
    const request = jest.fn(async (url, lookupFn) => { await lookupFn(url.hostname); return validResponse(); });
    await expect(new HardenedJwksTransport({ resolve, request }).fetch('https://issuer.example.test/jwks')).resolves.toEqual({ keys: [{}] });
    expect(request).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledTimes(2);
  });
  it('bounds pre-DNS, connection-DNS, and slow body retrieval', async () => {
    await expect(new HardenedJwksTransport({ timeoutMs: 10, resolve: () => new Promise(() => {}) }).fetch('https://issuer.example.test/jwks')).rejects.toBeInstanceOf(JwksTransportError);
    await expect(new HardenedJwksTransport({ timeoutMs: 10, resolve: jest.fn().mockResolvedValueOnce(['8.8.8.8']).mockImplementationOnce(() => new Promise(() => {})), request: async (url, lookupFn) => { await lookupFn(url.hostname); return validResponse(); } }).fetch('https://issuer.example.test/jwks')).rejects.toBeInstanceOf(JwksTransportError);
    await expect(new HardenedJwksTransport({ timeoutMs: 10, resolve: async () => ['8.8.8.8'], request: async () => ({ statusCode: 200, headers: { 'content-type': 'application/json' }, body: (async function* () { await new Promise((resolve) => setTimeout(resolve, 50)); yield Buffer.from('{"keys":[{}]}'); })() }) }).fetch('https://issuer.example.test/jwks')).rejects.toBeInstanceOf(JwksTransportError);
  });
  it('has no production loopback or validation bypass', async () => {
    const source = await readFile(resolvePath(process.cwd(), 'src/upstream-auth/jwks-transport.adapter.ts'), 'utf8');
    expect(source).not.toMatch(/allowTestLoopback|allowLoopback|skip.*validat|httpRequest/i);
  });
});

function fakeTransport(response: { statusCode: number; headers: Record<string, string>; chunks: Buffer[] }) {
  return new HardenedJwksTransport({ resolve: async () => ['8.8.8.8'], request: async () => ({ ...response, body: (async function* () { yield* response.chunks; })() }) });
}
function validResponse() { return { statusCode: 200, headers: { 'content-type': 'application/json' }, body: (async function* () { yield Buffer.from('{"keys":[{}]}'); })() }; }

function settleLookup(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function invokeAllLookup(options: LookupOptions & { all: true }, addresses: readonly string[]): Promise<LookupAddress[]> {
  return new Promise((resolve, reject) => {
    createValidatedSocketLookup(async () => [...addresses])('issuer.example.test', options, (error, result) => {
      if (error) reject(error);
      else if (Array.isArray(result)) resolve(result);
      else reject(new Error('lookup did not use the all-results callback contract'));
    });
  });
}
