import { HttpException, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ExchangeController } from '../../src/exchange/exchange.controller';
import {
  ExchangeIdentityDeniedError,
  ExchangeUnavailableError
} from '../../src/exchange/redaction';
import { IdxTransportError } from '../../src/idx/transport/transport.error';

const requestId = '123e4567-e89b-42d3-a456-426614174000';

describe('Identity Bridge exchange controller', () => {
  it('exposes only POST /identity/exchange and returns the exact safe success response', async () => {
    const service = { exchange: jest.fn().mockResolvedValue({ accessToken: 'canonical-token', tokenType: 'Bearer', expiresIn: 300 }) };
    const controller = new ExchangeController(service as never);

    expect(Reflect.getMetadata(PATH_METADATA, ExchangeController)).toBe('identity');
    expect(Reflect.getMetadata(PATH_METADATA, ExchangeController.prototype.exchange)).toBe('exchange');
    expect(Reflect.getMetadata(METHOD_METADATA, ExchangeController.prototype.exchange)).toBe(RequestMethod.POST);
    await expect(controller.exchange('Bearer native-token', requestId, {})).resolves.toEqual({
      accessToken: 'canonical-token', tokenType: 'Bearer', expiresIn: 300
    });
    expect(service.exchange).toHaveBeenCalledWith('native-token');
  });

  it.each([
    ...['entryId', 'UUID_Entry', 'selectedEntry', 'integrationSelector', 'customerId', 'integration_id', 'host_app', 'issuer', 'audience', 'roles', 'permissionScopes', 'provider', 'endpoint', 'MenuDetail', 'claims', 'refreshToken']
      .map((field) => [`authority body ${field}`, 'Bearer native-token', { [field]: 'browser-choice' }]),
    ['non-object body', 'Bearer native-token', 'body'],
    ['wrong scheme', 'Basic native-token', {}],
    ['whitespace credential', 'Bearer native token', {}]
  ])('returns generic 400 for %s', async (_case, authorization, body) => {
    await expectError(new ExchangeController({ exchange: jest.fn() } as never), authorization, body, 400, 'IDENTITY_EXCHANGE_REQUEST_INVALID');
  });

  it('accepts a genuinely absent body', async () => {
    const service = { exchange: jest.fn().mockResolvedValue({ accessToken: 'canonical-token', tokenType: 'Bearer', expiresIn: 300 }) };
    await expect(new ExchangeController(service as never).exchange('Bearer native-token', requestId, undefined)).resolves.toEqual({ accessToken: 'canonical-token', tokenType: 'Bearer', expiresIn: 300 });
  });

  it.each([undefined, '', '   '])('returns generic 401 for a missing credential', async (authorization) => {
    await expectError(new ExchangeController({ exchange: jest.fn() } as never), authorization, {}, 401, 'IDENTITY_EXCHANGE_IDENTITY_INVALID');
  });

  it.each([
    [new IdxTransportError('credential_rejected'), 401, 'IDENTITY_EXCHANGE_IDENTITY_INVALID'],
    [new IdxTransportError('identity_denied'), 403, 'IDENTITY_EXCHANGE_IDENTITY_DENIED'],
    [new IdxTransportError('provider_unavailable'), 503, 'IDENTITY_EXCHANGE_UNAVAILABLE'],
    [new ExchangeIdentityDeniedError(), 403, 'IDENTITY_EXCHANGE_IDENTITY_DENIED'],
    [new ExchangeUnavailableError(), 503, 'IDENTITY_EXCHANGE_UNAVAILABLE'],
    [new Error('unexpected-sensitive-detail'), 503, 'IDENTITY_EXCHANGE_UNAVAILABLE']
  ])('projects runtime failure to a safe public response', async (failure, status, code) => {
    const controller = new ExchangeController({ exchange: jest.fn().mockRejectedValue(failure) } as never);
    await expectError(controller, 'Bearer native-token', {}, status as number, code as string);
  });

  it('replaces unsafe request correlation with a generated UUID', async () => {
    const controller = new ExchangeController({ exchange: jest.fn().mockRejectedValue(new Error('failure')) } as never);
    const error = await capture(controller.exchange('Bearer native-token', 'Bearer native-token', {}));
    const response = error.getResponse() as Record<string, unknown>;
    expect(response.requestId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(response.requestId).not.toBe('Bearer native-token');
  });
});

async function expectError(controller: ExchangeController, authorization: unknown, body: unknown, status: number, code: string): Promise<void> {
  const error = await capture(controller.exchange(authorization, requestId, body));
  expect(error.getStatus()).toBe(status);
  expect(error.getResponse()).toEqual({
    statusCode: status,
    code,
    message: expect.any(String),
    requestId
  });
  expect(Object.keys(error.getResponse() as object).sort()).toEqual(['code', 'message', 'requestId', 'statusCode']);
}

async function capture(promise: Promise<unknown>): Promise<HttpException> {
  try { await promise; } catch (error) { expect(error).toBeInstanceOf(HttpException); return error as HttpException; }
  throw new Error('Expected exchange request to fail.');
}
