import { HttpException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { IdxTransportError } from '../idx/transport/transport.error';

export class ExchangeRequestError extends Error {
  constructor() { super('Identity exchange request is invalid.'); this.name = 'ExchangeRequestError'; }
}

export class ExchangeCredentialError extends Error {
  constructor() { super('Identity exchange identity is invalid.'); this.name = 'ExchangeCredentialError'; }
}

export class ExchangeIdentityDeniedError extends Error {
  constructor() { super('Identity exchange identity is denied.'); this.name = 'ExchangeIdentityDeniedError'; }
}

export class ExchangeUnavailableError extends Error {
  constructor() { super('Identity exchange is unavailable.'); this.name = 'ExchangeUnavailableError'; }
}

export function normalizeExchangeRequestId(value: unknown): string {
  if (typeof value === 'string') {
    const normalized = value.trim();
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)) return normalized;
  }
  return randomUUID();
}

export function projectExchangeError(error: unknown, requestId: string): HttpException {
  if (error instanceof ExchangeRequestError) return response(400, 'IDENTITY_EXCHANGE_REQUEST_INVALID', 'Identity exchange request is invalid.', requestId);
  if (error instanceof ExchangeCredentialError || error instanceof IdxTransportError && error.category === 'credential_rejected') {
    return response(401, 'IDENTITY_EXCHANGE_IDENTITY_INVALID', 'Identity exchange identity is invalid.', requestId);
  }
  if (error instanceof ExchangeIdentityDeniedError || error instanceof IdxTransportError && error.category === 'identity_denied') {
    return response(403, 'IDENTITY_EXCHANGE_IDENTITY_DENIED', 'Identity exchange identity is denied.', requestId);
  }
  return response(503, 'IDENTITY_EXCHANGE_UNAVAILABLE', 'Identity exchange is unavailable.', requestId);
}

function response(statusCode: number, code: string, message: string, requestId: string): HttpException {
  return new HttpException(Object.freeze({ statusCode, code, message, requestId }), statusCode);
}
