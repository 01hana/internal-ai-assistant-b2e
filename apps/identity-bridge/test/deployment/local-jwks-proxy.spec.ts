import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const targetPath = resolve(__dirname, '../../scripts/local-jwks-proxy.cjs');

type ProxyModule = Readonly<{
  HOST: string;
  PORT: number;
  UPSTREAM_JWKS_URL: string;
  MAX_RESPONSE_BYTES: number;
  createLocalJwksProxy: (input?: Readonly<{ requestUpstream?: () => Promise<unknown> }>) => import('node:http').Server;
  handleLocalJwksRequest: (request: unknown, response: unknown, requestUpstream: () => Promise<unknown>) => Promise<void>;
}>;

describe('Feature 007 local JWKS-only proxy', () => {
  const load = (): ProxyModule => require(targetPath) as ProxyModule;

  it('fixes the loopback listener and Bridge JWKS upstream with no arbitrary destination surface', () => {
    const target = load();
    expect(target).toMatchObject({
      HOST: '127.0.0.1',
      PORT: 3110,
      UPSTREAM_JWKS_URL: 'http://127.0.0.1:3107/.well-known/jwks.json',
      MAX_RESPONSE_BYTES: 256 * 1024
    });
    const source = readFileSync(targetPath, 'utf8');
    expect(source).not.toMatch(/0\.0\.0\.0|process\.env.*(?:UPSTREAM|HOST|PORT)|authorization|cookie/i);
  });

  it('returns only normalized JSON from an exact successful bounded upstream response', async () => {
    const requestUpstream = jest.fn(async () => upstream(200, 'application/jwk-set+json', '{"keys":[{"kty":"RSA"}]}'));
    const result = await invoke(load(), 'GET', '/.well-known/jwks.json', requestUpstream);
    expect(result).toMatchObject({ status: 200, contentType: 'application/json' });
    expect(JSON.parse(result.body)).toEqual({ keys: [{ kty: 'RSA' }] });
    expect(requestUpstream).toHaveBeenCalledTimes(1);
    expect(requestUpstream).toHaveBeenCalledWith();
  });

  it('rejects every other path and every non-GET method without touching upstream', async () => {
    const requestUpstream = jest.fn();
    await expect(invoke(load(), 'GET', '/identity/exchange', requestUpstream)).resolves.toMatchObject({ status: 404 });
    await expect(invoke(load(), 'GET', '/health', requestUpstream)).resolves.toMatchObject({ status: 404 });
    await expect(invoke(load(), 'GET', '/ready', requestUpstream)).resolves.toMatchObject({ status: 404 });
    await expect(invoke(load(), 'GET', '/.well-known/jwks.json?target=http://elsewhere', requestUpstream)).resolves.toMatchObject({ status: 404 });
    await expect(invoke(load(), 'POST', '/.well-known/jwks.json', requestUpstream)).resolves.toMatchObject({ status: 405 });
    expect(requestUpstream).not.toHaveBeenCalled();
  });

  it.each([
    ['status', upstream(302, 'application/json', '{}')],
    ['content type', upstream(200, 'text/plain', '{}')],
    ['malformed JSON', upstream(200, 'application/json', '{secret-response-body')],
    ['oversized response', upstream(200, 'application/json', `{"keys":["${'a'.repeat(256 * 1024)}"]}`)]
  ])('projects %s failures to a generic response without provider material', async (_case, response) => {
    const result = await invoke(load(), 'GET', '/.well-known/jwks.json', async () => response);
    expect(result).toMatchObject({ status: 502, body: '{"error":"jwks_upstream_unavailable"}' });
    expect(result.body).not.toMatch(/secret-response-body|RSA|"keys"/);
  });
});

function upstream(statusCode: number, contentType: string, body: string) {
  return { statusCode, headers: { 'content-type': contentType }, body: chunks(body) };
}

async function* chunks(value: string) { yield Buffer.from(value); }

async function invoke(target: ProxyModule, method: string, url: string, requestUpstream: () => Promise<unknown>) {
  const headers: Record<string, string> = {};
  let body = '';
  const incoming = { method, url, resume: jest.fn() };
  const outgoing = {
    statusCode: 0,
    setHeader: (name: string, value: string) => { headers[name.toLowerCase()] = value; },
    end: (value: Uint8Array) => { body = Buffer.from(value).toString('utf8'); }
  };
  await target.handleLocalJwksRequest(incoming, outgoing, requestUpstream);
  return { status: outgoing.statusCode, contentType: headers['content-type'], body };
}
