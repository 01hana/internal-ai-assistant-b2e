import { HardenedJwksTransport, JwksTransportError } from '../../src/upstream-auth/jwks-transport.adapter';
import { readFile } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';

describe('Hardened JWKS transport (T023/T024)', () => {
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
