import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ManagedExchangeActivationError, ManagedExchangeActivationValidator } from '../../src/managed-identity-exchange/persistence/managed-exchange-activation.validator';
import { ManagedExchangeCredentialError, ManagedExchangeInfrastructureError } from '../../src/managed-identity-exchange/domain/managed-exchange.domain';
import { DelegatedEndpointPolicy, DelegatedEndpointPolicyError } from '../../src/managed-identity-exchange/providers/delegated-endpoint.policy';
import { DelegatedHttpTransport } from '../../src/managed-identity-exchange/providers/delegated-http.transport';

const nativeCredential = 'DO_NOT_LEAK_NATIVE_SECRET';
const provider = (overrides: Record<string, unknown> = {}) => ({
  id: 'provider-a', providerType: 'delegated_http', endpointUri: 'https://provider.example.test/verify', httpMethod: 'POST',
  credentialPlacement: 'authorization_bearer', timeoutMilliseconds: 1_000, responseContractVersion: 'delegated-http/v1',
  declaredAnchorKinds: Object.freeze(['organization']), providerContract: Object.freeze({ anchorSchema: 'managed-verified-anchors/v1', responseSchema: 'managed-verified-identity/v1' }), ...overrides
});
const input = (overrides: Record<string, unknown> = {}) => ({ nativeCredential, providerInstancePolicy: provider(), requestId: 'request-a', ...overrides });
const response = (statusCode = 200, contentType: string | string[] = 'application/json', chunks: readonly Uint8Array[] = [Buffer.from('{"opaque":true}')], dispose = jest.fn()) => ({ statusCode, headers: { 'content-type': contentType }, body: (async function* () { yield* chunks; })(), dispose });

describe('Delegated endpoint and HTTP transport (T017/T018/T019)', () => {
  it.each([
    'http://provider.example.test/verify', 'ftp://provider.example.test/verify', 'https://user@provider.example.test/verify',
    'https://user:password@provider.example.test/verify', 'https://provider.example.test/verify#fragment', 'https://localhost/verify',
    'https://127.0.0.1/verify', 'https://[::1]/verify', 'not a url'
  ])('rejects unsafe registered endpoint %s', (endpointUri) => {
    expect(() => new DelegatedEndpointPolicy().validate(provider({ endpointUri }) as never)).toThrow(DelegatedEndpointPolicyError);
  });

  it.each([
    { httpMethod: 'GET' }, { credentialPlacement: 'query' }, { responseContractVersion: 'unknown/v1' }, { timeoutMilliseconds: 5_001 }
  ])('rejects unsupported fixed delegated runtime settings', (overrides) => {
    expect(() => new DelegatedEndpointPolicy().validate(provider(overrides) as never)).toThrow(DelegatedEndpointPolicyError);
  });

  it('applies endpoint policy during provider registration validation', () => {
    expect(() => new ManagedExchangeActivationValidator().validateProvider({
      id: 'provider-a', providerType: 'delegated_http', endpointUri: 'https://127.0.0.1/verify', httpMethod: 'POST',
      credentialPlacement: 'authorization_bearer', timeoutMilliseconds: 1_000, responseContractVersion: 'delegated-http/v1',
      declaredAnchorKinds: ['organization'], contractConfig: { anchorSchema: 'managed-verified-anchors/v1', responseSchema: 'managed-verified-identity/v1' }
    })).toThrow(ManagedExchangeActivationError);
  });

  it.each(['127.0.0.1', '::1', '10.0.0.1', '169.254.1.1', 'fe80::1', '0.0.0.0', '224.0.0.1', '203.0.113.1'])('rejects prohibited DNS destination %s', async (address) => {
    const request = jest.fn(async () => response());
    await expect(transport({ resolve: async () => [address], request }).execute(input() as never)).rejects.toBeInstanceOf(ManagedExchangeInfrastructureError);
    expect(request).not.toHaveBeenCalled();
  });

  it('fails closed for mixed DNS answers and connection-time rebinding', async () => {
    const mixedRequest = jest.fn(async () => response());
    await expect(transport({ resolve: async () => ['8.8.8.8', '127.0.0.1'], request: mixedRequest }).execute(input() as never)).rejects.toBeInstanceOf(ManagedExchangeInfrastructureError);
    expect(mixedRequest).not.toHaveBeenCalled();

    const resolve = jest.fn().mockResolvedValueOnce(['8.8.8.8']).mockResolvedValueOnce(['127.0.0.1']);
    const request = jest.fn(async (url, options) => { await options.lookup(url.hostname); return response(); });
    await expect(transport({ resolve, request }).execute(input() as never)).rejects.toBeInstanceOf(ManagedExchangeInfrastructureError);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('forwards an opaque credential exactly once in the fixed Authorization header', async () => {
    const request = jest.fn(async (_url, options) => {
      expect(options.method).toBe('POST');
      expect(options.headers).toEqual({ accept: 'application/json', authorization: `Bearer ${nativeCredential}` });
      expect(Object.keys(options.headers)).not.toContain('cookie');
      expect(Object.keys(options.headers)).not.toContain('x-forwarded-for');
      await options.lookup('provider.example.test');
      return response();
    });
    await expect(transport({ request }).execute(input() as never)).resolves.toEqual({ status: 200, contentType: 'application/json', body: { opaque: true } });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['redirect', response(302)], ['unsupported MIME', response(200, 'text/html')], ['missing MIME', response(200, '')], ['malformed JSON', response(200, 'application/json', [Buffer.from('{')])],
    ['over-limit body', response(200, 'application/json', [Buffer.alloc(256 * 1024 + 1)])], ['mixed MIME headers', response(200, ['application/json', 'text/html'])], ['duplicate MIME headers', response(200, ['application/json', 'application/json'])]
  ])('rejects unsafe or malformed response: %s', async (_label, unsafeResponse) => {
    await expect(transport({ request: async () => unsafeResponse }).execute(input() as never)).rejects.toBeInstanceOf(ManagedExchangeInfrastructureError);
  });

  it.each([
    ['redirect', response(302), ManagedExchangeInfrastructureError],
    ['credential rejection', response(401), ManagedExchangeCredentialError],
    ['forbidden credential', response(403), ManagedExchangeCredentialError],
    ['unavailable provider', response(503), ManagedExchangeInfrastructureError],
    ['invalid MIME', response(200, 'text/html'), ManagedExchangeInfrastructureError],
    ['malformed JSON', response(200, 'application/json', [Buffer.from('{')]), ManagedExchangeInfrastructureError],
    ['over-limit body', response(200, 'application/json', [Buffer.alloc(256 * 1024 + 1)]), ManagedExchangeInfrastructureError]
  ])('aborts and disposes an established response after %s', async (_label, rawResponse, ErrorType) => {
    let signal: AbortSignal | undefined;
    const request = jest.fn(async (_url, options) => { signal = options.signal; return rawResponse; });
    await expect(transport({ request }).execute(input() as never)).rejects.toBeInstanceOf(ErrorType);
    expect(signal?.aborted).toBe(true);
    expect(rawResponse.dispose).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('does not abort or dispose a successful response', async () => {
    const rawResponse = response();
    let signal: AbortSignal | undefined;
    await expect(transport({ request: async (_url: URL, options: { signal: AbortSignal }) => { signal = options.signal; return rawResponse; } }).execute(input() as never)).resolves.toBeDefined();
    expect(signal?.aborted).toBe(false);
    expect(rawResponse.dispose).not.toHaveBeenCalled();
  });

  it('accepts JSON charset and bodies at or below the 256 KiB streaming limit', async () => {
    await expect(transport({ request: async () => response(200, 'application/json; charset=utf-8', [jsonOfSize(256 * 1024 - 1)]) }).execute(input() as never)).resolves.toBeDefined();
    await expect(transport({ request: async () => response(200, 'application/json', [jsonOfSize(256 * 1024)]) }).execute(input() as never)).resolves.toBeDefined();
  });

  it('classifies 401/403 as credential failures, never retries network/5xx failures, and redacts secrets', async () => {
    await expect(transport({ request: async () => response(401) }).execute(input() as never)).rejects.toBeInstanceOf(ManagedExchangeCredentialError);
    await expect(transport({ request: async () => response(403) }).execute(input() as never)).rejects.toBeInstanceOf(ManagedExchangeCredentialError);
    const request = jest.fn(async () => { throw new Error(nativeCredential); });
    const failure = await transport({ request }).execute(input() as never).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ManagedExchangeInfrastructureError);
    expect(String(failure)).not.toContain(nativeCredential);
    expect(JSON.stringify(failure)).not.toContain(nativeCredential);
    expect(request).toHaveBeenCalledTimes(1);
    const unavailable = jest.fn(async () => response(503));
    await expect(transport({ request: unavailable }).execute(input() as never)).rejects.toBeInstanceOf(ManagedExchangeInfrastructureError);
    expect(unavailable).toHaveBeenCalledTimes(1);
  });

  it('uses one abortable deadline for stalled DNS, connection, and body work', async () => {
    await expect(transport({ timeoutMs: 10, resolve: () => new Promise(() => {}) }).execute(input() as never)).rejects.toBeInstanceOf(ManagedExchangeInfrastructureError);
    await expect(transport({ timeoutMs: 10, resolve: jest.fn().mockResolvedValueOnce(['8.8.8.8']).mockImplementationOnce(() => new Promise(() => {})), request: async (url: URL, options: { lookup(hostname: string): Promise<readonly string[]> }) => { await options.lookup(url.hostname); return response(); } }).execute(input() as never)).rejects.toBeInstanceOf(ManagedExchangeInfrastructureError);
    await expect(transport({ timeoutMs: 10, request: async () => ({ statusCode: 200, headers: { 'content-type': 'application/json' }, body: (async function* () { await new Promise((done) => setTimeout(done, 30)); yield Buffer.from('{"opaque":true}'); })() }) }).execute(input() as never)).rejects.toBeInstanceOf(ManagedExchangeInfrastructureError);
  });

  it('has no production bypass, identity mapping, or forbidden authorities', () => {
    const endpointSource = readFileSync(resolve(__dirname, '../../src/managed-identity-exchange/providers/delegated-endpoint.policy.ts'), 'utf8');
    const transportSource = readFileSync(resolve(__dirname, '../../src/managed-identity-exchange/providers/delegated-http.transport.ts'), 'utf8');
    expect(`${endpointSource}\n${transportSource}`).not.toMatch(/Customer|CustomerScope|IntegrationBinding|PageContext|IDX|ES512|UserType|IsAdmin|decodeJwt|canonicalize|issue\(/i);
    expect(transportSource).not.toMatch(/ALLOW_PRIVATE|ALLOW_LOCALHOST|allowTestLoopback|retry/i);
  });
});

function transport(overrides: Record<string, unknown> = {}) {
  return new DelegatedHttpTransport({ resolve: async () => ['8.8.8.8'], request: async () => response(), ...overrides } as never);
}

function jsonOfSize(size: number): Buffer {
  const prefix = Buffer.from('{"value":"');
  const suffix = Buffer.from('"}');
  return Buffer.concat([prefix, Buffer.alloc(size - prefix.length - suffix.length, 'a'), suffix]);
}
