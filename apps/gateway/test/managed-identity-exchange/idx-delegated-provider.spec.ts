import {
  ManagedExchangeCredentialError,
  ManagedExchangeIdentityDeniedError,
  ManagedExchangeInfrastructureError
} from '../../src/managed-identity-exchange/domain/managed-exchange.domain';
import { projectManagedExchangeError } from '../../src/managed-identity-exchange/exchange-error.projector';
import { DelegatedHttpTransport } from '../../src/managed-identity-exchange/providers/delegated-http.transport';

const nativeCredential = 'DO_NOT_LEAK_NATIVE_ACCESS_TOKEN';
const diagnostic = 'DO_NOT_LEAK_PROVIDER_DIAGNOSTIC';
const provider = Object.freeze({
  id: 'provider-idx', providerType: 'idx_delegated', endpointUri: 'https://provider.example.test/menu-detail', httpMethod: 'GET',
  credentialPlacement: 'authorization_bearer', timeoutMilliseconds: 1_000, responseContractVersion: 'idx-menu-detail/v1',
  declaredAnchorKinds: Object.freeze(['idx_entry']), providerContract: Object.freeze({ responseSchema: 'idx-menu-detail/v1', contentType: 'application/json' })
});
const input = Object.freeze({ nativeCredential, providerInstancePolicy: provider, requestId: 'request-idx' });
const response = (statusCode = 200, contentType: string | string[] = 'application/json', body = '{"opaque":true}') => Object.freeze({
  statusCode, headers: { 'content-type': contentType }, body: (async function* () { yield Buffer.from(body); })(), dispose: jest.fn()
});

describe('IDX-shaped delegated transport failure classification (T014)', () => {
  it.each([
    ['401 credential rejection', { request: async () => response(401, 'application/json', diagnostic) }, ManagedExchangeCredentialError],
    ['403 authorization denial', { request: async () => response(403, 'application/json', diagnostic) }, ManagedExchangeIdentityDeniedError],
    ['500 provider failure', { request: async () => response(500, 'application/json', diagnostic) }, ManagedExchangeInfrastructureError],
    ['503 provider failure', { request: async () => response(503, 'application/json', diagnostic) }, ManagedExchangeInfrastructureError],
    ['network failure', { request: async () => { throw new Error(`${nativeCredential}:${diagnostic}`); } }, ManagedExchangeInfrastructureError],
    ['unsafe DNS', { resolve: async () => ['127.0.0.1'], request: async () => response() }, ManagedExchangeInfrastructureError],
    ['malformed JSON success', { request: async () => response(200, 'application/json', '{') }, ManagedExchangeInfrastructureError],
    ['invalid content type success', { request: async () => response(200, 'text/html', diagnostic) }, ManagedExchangeInfrastructureError],
    ['oversized success', { request: async () => response(200, 'application/json', 'x'.repeat(256 * 1024 + 1)) }, ManagedExchangeInfrastructureError]
  ])('classifies %s without exposing native or provider diagnostics', async (_label, overrides, ErrorType) => {
    const failure = await transport(overrides).execute(input).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ErrorType);
    assertRedacted(failure);
  });

  it('classifies deadline expiry as unavailable without retrying', async () => {
    const request = jest.fn(async () => response());
    const failure = await transport({ timeoutMs: 10, resolve: () => new Promise(() => {}), request }).execute(input).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ManagedExchangeInfrastructureError);
    expect(request).not.toHaveBeenCalled();
    assertRedacted(failure);
  });

  it('retains the established non-enumerating 401, 403, and 503 public envelopes', () => {
    for (const [error, status, code] of [
      [new ManagedExchangeCredentialError(), 401, 'EXCHANGE_IDENTITY_INVALID'],
      [new ManagedExchangeIdentityDeniedError(), 403, 'EXCHANGE_IDENTITY_DENIED'],
      [new ManagedExchangeInfrastructureError(), 503, 'EXCHANGE_SERVICE_UNAVAILABLE']
    ] as const) {
      const projected = projectManagedExchangeError(error).getResponse() as Record<string, unknown>;
      expect(projected).toMatchObject({ statusCode: status, code });
      expect(JSON.stringify(projected)).not.toContain(nativeCredential);
      expect(JSON.stringify(projected)).not.toContain(diagnostic);
    }
  });
});

function transport(overrides: Record<string, unknown> = {}) {
  return new DelegatedHttpTransport({ resolve: async () => ['8.8.8.8'], request: async () => response(), ...overrides } as never);
}

function assertRedacted(error: unknown): void {
  expect(String(error)).not.toContain(nativeCredential);
  expect(String(error)).not.toContain(diagnostic);
  expect(JSON.stringify(error)).not.toContain(nativeCredential);
  expect(JSON.stringify(error)).not.toContain(diagnostic);
}
