import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import {
  ManagedExchangeCredentialError,
  ManagedExchangeIdentityDeniedError,
  ManagedExchangeInfrastructureError,
  ManagedExchangeIssuanceError
} from '../../src/managed-identity-exchange/domain/managed-exchange.domain';
import { ManagedIdentityExchangeService } from '../../src/managed-identity-exchange/exchange.service';
import { ManagedIdentityExchangeController } from '../../src/managed-identity-exchange/exchange.controller';

const controllerPath = resolve(__dirname, '../../src/managed-identity-exchange/exchange.controller.ts');
const validationPath = resolve(__dirname, '../../src/managed-identity-exchange/exchange-request.validation.ts');
const projectorPath = resolve(__dirname, '../../src/managed-identity-exchange/exchange-error.projector.ts');
const nativeCredential = 'DO_NOT_LEAK_NATIVE_CREDENTIAL';
const sentinels = Object.freeze([
  nativeCredential,
  'DO_NOT_LEAK_MANAGED_JWT',
  'https://secret-provider.example.test/verify',
  'https://secret-managed-issuer.test',
  'DO_NOT_LEAK_KEY_REFERENCE',
  'DO_NOT_LEAK_ANCHOR',
  'DO_NOT_LEAK_PERMISSION_SCOPE',
  'DO_NOT_LEAK_CUSTOMER_ID',
  'DO_NOT_LEAK_PROVIDER_DIAGNOSTIC'
]);

type ExchangeServiceDouble = Readonly<{ exchange: jest.Mock }>;

describe('Managed exchange HTTP public contract (T036)', () => {
  it('uses only POST /api/v1/identity/exchange, exact Bearer transport, and exact success projection', async () => {
    const fixture = await fixtureFor();
    try {
      const response = await request(fixture.app.getHttpServer())
        .post('/api/v1/identity/exchange')
        .set('Authorization', `Bearer ${nativeCredential}`)
        .set('x-request-id', 'request-a')
        .send({ integrationSelector: 'selector-a' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ accessToken: 'managed-token', tokenType: 'Bearer', expiresIn: 300, requestId: 'request-a' });
      expect(Object.keys(response.body).sort()).toEqual(['accessToken', 'expiresIn', 'requestId', 'tokenType']);
      expect(fixture.exchange).toHaveBeenCalledTimes(1);
      expect(fixture.exchange).toHaveBeenCalledWith({ integrationSelector: 'selector-a', nativeCredential, requestId: 'request-a' });
      expectNoCookieOrRedirect(response);
    } finally {
      await fixture.close();
    }
  });

  it.each([
    ['GET exchange route', 'get', '/api/v1/identity/exchange'],
    ['sibling POST route', 'post', '/api/v1/identity/exchange/extra']
  ])('does not expose the public exchange endpoint through %s', async (_label, method, path) => {
    const fixture = await fixtureFor();
    try {
      const server = request(fixture.app.getHttpServer());
      const response = method === 'get' ? await server.get(path) : await server.post(path);
      expect(response.status).toBe(404);
      expect(fixture.exchange).not.toHaveBeenCalled();
    } finally {
      await fixture.close();
    }
  });

  it('normalizes missing and blank request IDs once and preserves them only for service/success response use', async () => {
    for (const requestId of [undefined, '   ']) {
      const fixture = await fixtureFor();
      try {
        let call = request(fixture.app.getHttpServer())
          .post('/api/v1/identity/exchange')
          .set('Authorization', `Bearer ${nativeCredential}`)
          .send({ integrationSelector: 'selector-a' });
        if (requestId !== undefined) call = call.set('x-request-id', requestId);
        const response = await call;
        const received = fixture.exchange.mock.calls[0][0] as Record<string, unknown>;
        expect(response.status).toBe(200);
        expect(received.requestId).toEqual(expect.any(String));
        expect(received.requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
        expect(response.body.requestId).toBe(received.requestId);
      } finally {
        await fixture.close();
      }
    }
  });

  it('keeps trace and unrelated browser headers out of service authority', async () => {
    const fixture = await fixtureFor();
    try {
      const response = await request(fixture.app.getHttpServer())
        .post('/api/v1/identity/exchange')
        .set('Authorization', `Bearer ${nativeCredential}`)
        .set('x-request-id', 'request-a')
        .set('traceparent', '00-0123456789abcdef0123456789abcdef-0123456789abcdef-01')
        .set('x-customer-id', 'DO_NOT_LEAK_CUSTOMER_ID')
        .set('x-integration-id', 'forged-integration')
        .set('x-host-app', 'forged-host')
        .set('x-provider-type', 'forged-provider')
        .send({ integrationSelector: 'selector-a' });

      expect(response.status).toBe(200);
      expect(fixture.exchange).toHaveBeenCalledWith({ integrationSelector: 'selector-a', nativeCredential, requestId: 'request-a' });
      expect(Object.keys(fixture.exchange.mock.calls[0][0] as object).sort()).toEqual(['integrationSelector', 'nativeCredential', 'requestId']);
    } finally {
      await fixture.close();
    }
  });

  it.each([
    ['missing Authorization', undefined],
    ['empty Authorization', ''],
    ['Basic credential', 'Basic abc'],
    ['Bearer without credential', 'Bearer'],
    ['Bearer blank credential', 'Bearer '],
    ['multi-part Bearer credential', 'Bearer first second']
  ])('rejects malformed Authorization: %s', async (_label, authorization) => {
    const fixture = await fixtureFor();
    try {
      let call = request(fixture.app.getHttpServer()).post('/api/v1/identity/exchange').send({ integrationSelector: 'selector-a' });
      if (authorization !== undefined) call = call.set('Authorization', authorization);
      const response = await call;
      expectInvalidRequest(response, fixture.exchange);
    } finally {
      await fixture.close();
    }
  });

  it.each([
    ['null', 'null'],
    ['array', []],
    ['string', '"selector-a"'],
    ['empty object', {}],
    ['missing selector', { another: 'value' }],
    ['unexpected generic field', { integrationSelector: 'selector-a', unexpected: 'value' }],
    ['numeric selector', { integrationSelector: 7 }],
    ['blank selector', { integrationSelector: '   ' }],
    ['control-character selector', { integrationSelector: 'selector\n-a' }],
    ['customer authority', { integrationSelector: 'selector-a', customerId: 'DO_NOT_LEAK_CUSTOMER_ID' }],
    ['integration authority', { integrationSelector: 'selector-a', integrationId: 'forged-integration' }],
    ['snake-case integration authority', { integrationSelector: 'selector-a', integration_id: 'forged-integration' }],
    ['host authority', { integrationSelector: 'selector-a', hostApp: 'forged-host' }],
    ['snake-case host authority', { integrationSelector: 'selector-a', host_app: 'forged-host' }],
    ['roles authority', { integrationSelector: 'selector-a', roles: ['admin'] }],
    ['scope authority', { integrationSelector: 'selector-a', permission_scopes: ['DO_NOT_LEAK_PERMISSION_SCOPE'] }],
    ['provider authority', { integrationSelector: 'selector-a', providerType: 'forged-provider' }],
    ['endpoint authority', { integrationSelector: 'selector-a', endpointUri: 'https://secret-provider.example.test/verify' }],
    ['credential authority', { integrationSelector: 'selector-a', nativeCredential }],
    ['Authorization authority', { integrationSelector: 'selector-a', authorization: nativeCredential }],
    ['headers authority', { integrationSelector: 'selector-a', headers: { authorization: nativeCredential } }],
    ['page context authority', { integrationSelector: 'selector-a', pageContext: { customerId: 'DO_NOT_LEAK_CUSTOMER_ID' } }],
    ['trace authority', { integrationSelector: 'selector-a', traceparent: '00-forged' }]
  ])('rejects malformed or authority-bearing body: %s', async (_label, body) => {
    const fixture = await fixtureFor();
    try {
      const call = request(fixture.app.getHttpServer())
        .post('/api/v1/identity/exchange')
        .set('Authorization', `Bearer ${nativeCredential}`);
      const response = await call.send(body);
      expectInvalidRequest(response, fixture.exchange);
    } finally {
      await fixture.close();
    }
  });

  it('maps all selector, provider credential, and admission denials to the same redacted 401 body', async () => {
    const responses = await errorResponses([
      new ManagedExchangeCredentialError(),
      sensitive(new ManagedExchangeCredentialError()),
      sensitive(new ManagedExchangeCredentialError()),
      sensitive(new ManagedExchangeCredentialError())
    ]);
    expectEquivalent(responses, 401, 'EXCHANGE_IDENTITY_INVALID', 'Managed identity exchange identity is invalid.');
  });

  it('maps permission and canonicalization denials to the same redacted 403 body', async () => {
    const responses = await errorResponses([
      sensitive(new ManagedExchangeIdentityDeniedError()),
      sensitive(new ManagedExchangeIdentityDeniedError())
    ]);
    expectEquivalent(responses, 403, 'EXCHANGE_IDENTITY_DENIED', 'Managed identity exchange identity is denied.');
  });

  it('maps infrastructure, issuance, audit, and unexpected failures to the same redacted 503 body', async () => {
    const responses = await errorResponses([
      sensitive(new ManagedExchangeInfrastructureError()),
      sensitive(new ManagedExchangeInfrastructureError()),
      sensitive(new ManagedExchangeInfrastructureError()),
      sensitive(new ManagedExchangeInfrastructureError()),
      sensitive(new ManagedExchangeIssuanceError()),
      new Error(sentinels.join(' '))
    ]);
    expectEquivalent(responses, 503, 'EXCHANGE_SERVICE_UNAVAILABLE', 'Managed identity exchange is unavailable.');
  });

  it('keeps public errors to the four fixed Feature 005 codes and omits request IDs', async () => {
    const fixtures = [
      [new ManagedExchangeCredentialError(), 401, 'EXCHANGE_IDENTITY_INVALID'],
      [new ManagedExchangeIdentityDeniedError(), 403, 'EXCHANGE_IDENTITY_DENIED'],
      [new ManagedExchangeInfrastructureError(), 503, 'EXCHANGE_SERVICE_UNAVAILABLE'],
      [new ManagedExchangeIssuanceError(), 503, 'EXCHANGE_SERVICE_UNAVAILABLE']
    ] as const;
    for (const [failure, status, code] of fixtures) {
      const fixture = await fixtureFor(failure);
      try {
        const response = await validRequest(fixture);
        expect(response.status).toBe(status);
        expect(response.body.code).toBe(code);
        expect(Object.keys(response.body).sort()).toEqual(['code', 'message', 'statusCode']);
        expectNoFailureTokenOrSecrets(response);
      } finally {
        await fixture.close();
      }
    }
  });

  it('keeps representative success and failure responses free of cookies and redirects', async () => {
    const success = await fixtureFor();
    const failure = await fixtureFor(sensitive(new ManagedExchangeInfrastructureError()));
    try {
      expectNoCookieOrRedirect(await validRequest(success));
      expectNoCookieOrRedirect(await validRequest(failure));
    } finally {
      await success.close();
      await failure.close();
    }
  });

  it('constrains the future controller, validator, and projector to their public-boundary roles', async () => {
    const controller = readFileSync(controllerPath, 'utf8');
    const validator = readFileSync(validationPath, 'utf8');
    const projector = readFileSync(projectorPath, 'utf8');
    expect(controller).not.toMatch(/ManagedIntegrationExchangeConfigRepository|ManagedIdentityProviderInstanceRepository|IdentityProviderAdapterRegistry|IntegrationAdmissionService|ManagedPermissionService|ManagedCanonicalizationService|ManagedTokenIssuer|ManagedSigningKeyProvider|GatewaySigningKeyRepository|CanonicalIdentityResolver|IntegrationBinding|Customer|fallback/i);
    expect(validator).not.toMatch(/decodeJwt|verify\(|findEnabledActive|Customer|IntegrationBinding|provider.*verify/i);
    expect(projector).not.toMatch(/error\.message|error\.stack|error\.cause|Gateway.*projector|Customer|IntegrationBinding/i);
  });
});

async function fixtureFor(failure?: Error): Promise<Readonly<{ app: INestApplication; exchange: ExchangeServiceDouble['exchange']; close(): Promise<void> }>> {
  const exchange = jest.fn(async () => {
    if (failure) throw failure;
    return Object.freeze({ accessToken: 'managed-token', tokenType: 'Bearer', expiresIn: 300 });
  });
  const module = await Test.createTestingModule({
    controllers: [ManagedIdentityExchangeController],
    providers: [{ provide: ManagedIdentityExchangeService, useValue: { exchange } }]
  }).compile();
  const app = module.createNestApplication();
  await app.init();
  return Object.freeze({ app, exchange, close: () => app.close() });
}

async function validRequest(fixture: Awaited<ReturnType<typeof fixtureFor>>) {
  return request(fixture.app.getHttpServer())
    .post('/api/v1/identity/exchange')
    .set('Authorization', `Bearer ${nativeCredential}`)
    .set('x-request-id', 'request-a')
    .send({ integrationSelector: 'selector-a' });
}

async function errorResponses(failures: readonly Error[]) {
  const responses = [];
  for (const failure of failures) {
    const fixture = await fixtureFor(failure);
    try { responses.push(await validRequest(fixture)); } finally { await fixture.close(); }
  }
  return responses;
}

function expectInvalidRequest(response: request.Response, exchange: ExchangeServiceDouble['exchange']): void {
  expect(response.status).toBe(400);
  expect(response.body).toEqual({ statusCode: 400, code: 'EXCHANGE_REQUEST_INVALID', message: 'Managed identity exchange request is invalid.' });
  expect(exchange).not.toHaveBeenCalled();
  expectNoFailureTokenOrSecrets(response);
}

function expectEquivalent(responses: readonly request.Response[], status: number, code: string, message: string): void {
  const expected = { statusCode: status, code, message };
  for (const response of responses) {
    expect(response.status).toBe(status);
    expect(response.body).toEqual(expected);
    expectNoFailureTokenOrSecrets(response);
  }
  expect(responses.map((response) => response.body)).toEqual(responses.map(() => expected));
}

function expectNoFailureTokenOrSecrets(response: request.Response): void {
  expect(Object.keys(response.body)).not.toEqual(expect.arrayContaining(['accessToken', 'tokenType', 'expiresIn', 'jti', 'kid', 'requestId']));
  expect(`${JSON.stringify(response.body)} ${JSON.stringify(response.headers)}`).not.toMatch(new RegExp(sentinels.join('|')));
  expectNoCookieOrRedirect(response);
}

function expectNoCookieOrRedirect(response: request.Response): void {
  expect(response.headers['set-cookie']).toBeUndefined();
  expect(response.headers.location).toBeUndefined();
}

function sensitive<T extends Error>(error: T): T {
  Object.assign(error, { diagnostic: sentinels.join(' ') });
  return error;
}
