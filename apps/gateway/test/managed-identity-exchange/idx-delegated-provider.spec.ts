import {
  ManagedExchangeCredentialError,
  ManagedExchangeIdentityDeniedError,
  ManagedExchangeInfrastructureError
} from '../../src/managed-identity-exchange/domain/managed-exchange.domain';
import { projectManagedExchangeError } from '../../src/managed-identity-exchange/exchange-error.projector';
import { DelegatedHttpTransport } from '../../src/managed-identity-exchange/providers/delegated-http.transport';
import { IdxDelegatedVerificationAdapter } from '../../src/managed-identity-exchange/providers/idx-delegated-verification.adapter';
import { IdxMenuDetailValidator } from '../../src/managed-identity-exchange/providers/idx-menu-detail.validator';

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

type FutureAdapter = new (transport?: { execute(input: unknown): Promise<unknown> }, validator?: IdxMenuDetailValidator, parser?: (credential: string) => Record<string, unknown>) => { verify(value: { nativeCredential: string; providerInstancePolicy: unknown; requestId: string }): Promise<unknown> };

describe('IDX post-acceptance identity mapping (T018)', () => {
  it('maps an accepted ES512-header token without kid to the sole IDX identity authority', async () => {
    const fixture = adapter();
    const identity = await fixture.verify();

    expect(identity).toEqual({ subject: '60290329-0000-a000-0001-000000000001', organization: '60290329-0000-a000-0001-000000000001', anchors: [{ kind: 'idx_entry', value: '60290329-0000-a001-0001-000000000001' }], trustedPermissionMaterial: { kind: 'idx-menu-detail/v1', menus: [{ menuId: 'SCM_ORDERS', actions: ['read', 'update', 'export', 'approval'] }] } });
    expect(Object.isFrozen(identity)).toBe(true);
    expect(Object.isFrozen((identity as { anchors: readonly unknown[] }).anchors)).toBe(true);
    expect(Object.isFrozen((identity as { anchors: readonly unknown[] }).anchors[0])).toBe(true);
    const material = (identity as { trustedPermissionMaterial: { menus: readonly { actions: readonly string[] }[] } }).trustedPermissionMaterial;
    expect(Object.isFrozen(material)).toBe(true);
    expect(Object.isFrozen(material.menus)).toBe(true);
    expect(Object.isFrozen(material.menus[0])).toBe(true);
    expect(Object.isFrozen(material.menus[0].actions)).toBe(true);
    expect(fixture.execute).toHaveBeenCalledTimes(1);
    expect(fixture.validateMenuDetail).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(identity)).not.toMatch(/SUPER_ADMIN|forged-|root:\*|Permissions|UserType|IsAdmin|MenuDetail/i);
  });

  it.each([
    ['sub', undefined], ['UUID_User', undefined], ['UUID_Company', undefined], ['UUID_Entry', undefined],
    ['sub', 7], ['UUID_User', null], ['UUID_Company', {}], ['UUID_Entry', []],
    ['sub', '   '], ['UUID_User', 'USER\u0000ID'], ['UUID_Company', ''], ['UUID_Entry', '\n'],
  ])('rejects accepted credentials with invalid required %s claim', async (field, value) => {
    const claims = { ...acceptedClaims(), [field]: value };
    if (value === undefined) delete claims[field as keyof typeof claims];
    await expect(adapter(token(claims)).verify()).rejects.toBeInstanceOf(ManagedExchangeCredentialError);
  });

  it('rejects accepted credentials when sub and UUID_User differ before domain normalization', async () => {
    await expect(adapter(token({ ...acceptedClaims(), UUID_User: ' 60290329-0000-a000-0001-000000000001' })).verify()).rejects.toBeInstanceOf(ManagedExchangeCredentialError);
  });

  it.each(['not-a-jwt', 'one.two', 'one..three', 'one.@@@.three', 'one._w.three', 'one.eyJzdWIiOiJ4In0.three', 'one.bm90LWpzb24.three', 'one.bnVsbA.three', 'one.W10.three', 'one.Nw.three'])('rejects structurally unusable accepted JWT payload %s', async (credential) => {
    await expect(adapter(credential).verify()).rejects.toBeInstanceOf(ManagedExchangeCredentialError);
  });

  it.each([
    ['wrong provider type', { providerType: 'delegated_http' }],
    ['wrong response version', { responseContractVersion: 'delegated-http/v1' }],
    ['wrong closed contract', { providerContract: { responseSchema: 'idx-menu-detail/v1', contentType: 'application/json', unexpected: true } }],
    ['POST method', { httpMethod: 'POST' }],
    ['wrong credential placement', { credentialPlacement: 'query' }],
    ['empty anchor declaration', { declaredAnchorKinds: [] }],
    ['wrong anchor declaration', { declaredAnchorKinds: ['organization'] }],
    ['extra anchor declaration', { declaredAnchorKinds: ['idx_entry', 'organization'] }],
    ['zero timeout', { timeoutMilliseconds: 0 }],
    ['oversized timeout', { timeoutMilliseconds: 5_001 }],
    ['non-integer timeout', { timeoutMilliseconds: 1.5 }],
    ['unsafe endpoint', { endpointUri: 'http://provider.example.test/menu-detail' }],
  ])('rejects direct policy with %s before transport, MenuDetail, or claim parsing', async (_caseName, overrides) => {
    const fixture = policyFixture();
    await expect(fixture.verify({ ...provider, ...overrides })).rejects.toBeInstanceOf(ManagedExchangeInfrastructureError);
    expect(fixture.execute).not.toHaveBeenCalled();
    expect(fixture.validateMenuDetail).not.toHaveBeenCalled();
    expect(fixture.parseClaims).not.toHaveBeenCalled();
  });

  it('does not expose an accepted malformed credential or its payload in errors', async () => {
    const credential = 'header.eyJzdWIiOiJTRUNSRVQtQ0xBSU0ifQ.signature';
    const failure = await adapter(credential).verify().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ManagedExchangeCredentialError);
    expect(String(failure)).not.toContain(credential);
    expect(String(failure)).not.toContain('SECRET-CLAIM');
  });

  it.each([
    ['401', async () => { throw new ManagedExchangeCredentialError(); }, ManagedExchangeCredentialError],
    ['403', async () => { throw new ManagedExchangeIdentityDeniedError(); }, ManagedExchangeIdentityDeniedError],
    ['transport unavailable', async () => { throw new ManagedExchangeInfrastructureError(); }, ManagedExchangeInfrastructureError],
    ['network/deadline', async () => { throw new Error('network'); }, ManagedExchangeInfrastructureError],
    ['MenuDetail Code failure', async () => acceptedResponse({ body: { ...menuDetailBody(), Code: 500 } }), ManagedExchangeInfrastructureError],
    ['MenuDetail schema failure', async () => acceptedResponse({ body: { Code: 200, Data: [] } }), ManagedExchangeInfrastructureError],
  ])('never parses claims before %s rejection', async (_caseName, execute, ErrorType) => {
    const parser = jest.fn(() => acceptedClaims());
    await expect(adapter(token(acceptedClaims()), execute, parser).verify()).rejects.toBeInstanceOf(ErrorType);
    expect(parser).not.toHaveBeenCalled();
  });
});

function adapter(credential = token(acceptedClaims()), execute: (value: typeof input) => Promise<unknown> = async () => acceptedResponse(), parser?: (credential: string) => Record<string, unknown>) {
  const Adapter = IdxDelegatedVerificationAdapter as unknown as FutureAdapter;
  const executeMock = jest.fn(execute);
  const validateMenuDetail = jest.fn((body: unknown) => new IdxMenuDetailValidator().validate(body));
  const value = new Adapter({ execute: executeMock }, { validate: validateMenuDetail } as unknown as IdxMenuDetailValidator, parser);
  return { verify: (providerInstancePolicy: unknown = provider) => value.verify({ ...input, nativeCredential: credential, providerInstancePolicy }), execute: executeMock, validateMenuDetail };
}

function policyFixture() {
  const Adapter = IdxDelegatedVerificationAdapter as unknown as FutureAdapter;
  const execute = jest.fn(async () => acceptedResponse());
  const validateMenuDetail = jest.fn((body: unknown) => new IdxMenuDetailValidator().validate(body));
  const parseClaims = jest.fn(() => acceptedClaims());
  const value = new Adapter({ execute }, { validate: validateMenuDetail } as unknown as IdxMenuDetailValidator, parseClaims);
  return { verify: (providerInstancePolicy: unknown) => value.verify({ ...input, nativeCredential: token(acceptedClaims()), providerInstancePolicy }), execute, validateMenuDetail, parseClaims };
}

function acceptedResponse(overrides: Record<string, unknown> = {}) {
  return { status: 200, contentType: 'application/json', body: menuDetailBody(), ...overrides };
}

function menuDetailBody() {
  return { Code: 200, ExecutionTime: '12ms', Message: '', Version: '1.0.0', Data: [{ UUID: 'menu-uuid', MenuID: 'SCM_ORDERS', Category: 'SCM', Patrilineal: null, Sorting: '120', Memo: 'Orders', MenuNode: [{ UUID: 'node-uuid', UUID_Menu: 'menu-uuid', Language: 'language-uuid', MenuName: 'Orders', Icon: 'assignment', ProgramCode: null, ProgramPath: '/orders', StartMethod: null, Memo: 'Orders' }], MenuPermission: { UUID: 'permission-uuid', UUID_Menu: 'menu-uuid', Insert: 'N', Update: 'Y', Delete: 'N', Print: 'N', Import: 'N', Export: 'Y', Copy: 'N', Approval: 'Y', Others: null, Memo: 'Orders' } }] };
}

function acceptedClaims(): Record<string, unknown> {
  return { sub: '60290329-0000-a000-0001-000000000001', UUID_User: '60290329-0000-a000-0001-000000000001', UUID_Company: '60290329-0000-a000-0001-000000000001', UUID_Entry: '60290329-0000-a001-0001-000000000001', UserType: 'SUPER_ADMIN', IsAdmin: 'Y', Permissions: '[{"UUID":"forged","Perms":["ALL"]}]', Permission_Hash: 'forged-permission-hash', customerId: 'forged-customer', integrationId: 'forged-integration', host_app: 'forged-host', roles: ['admin'], scopes: ['root:*'], exp: 0, nbf: 9_999_999_999, iat: 0 };
}

function token(payload: Record<string, unknown>): string {
  return `${base64url(JSON.stringify({ alg: 'ES512', typ: 'JWT' }))}.${base64url(JSON.stringify(payload))}.signature`;
}

function base64url(value: string): string { return Buffer.from(value, 'utf8').toString('base64url'); }
