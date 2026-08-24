import { HttpException } from '@nestjs/common';
import {
  ManagedExchangeCredentialError,
  ManagedExchangeIdentityDeniedError,
  ManagedExchangeInfrastructureError,
  ManagedExchangeIssuanceError,
  ManagedExchangeRequestError
} from './domain/managed-exchange.domain';

export function projectManagedExchangeError(error: unknown): HttpException {
  if (error instanceof ManagedExchangeRequestError) return response(400, 'EXCHANGE_REQUEST_INVALID', 'Managed identity exchange request is invalid.');
  if (error instanceof ManagedExchangeCredentialError) return response(401, 'EXCHANGE_IDENTITY_INVALID', 'Managed identity exchange identity is invalid.');
  if (error instanceof ManagedExchangeIdentityDeniedError) return response(403, 'EXCHANGE_IDENTITY_DENIED', 'Managed identity exchange identity is denied.');
  if (error instanceof ManagedExchangeInfrastructureError || error instanceof ManagedExchangeIssuanceError) {
    return response(503, 'EXCHANGE_SERVICE_UNAVAILABLE', 'Managed identity exchange is unavailable.');
  }
  return response(503, 'EXCHANGE_SERVICE_UNAVAILABLE', 'Managed identity exchange is unavailable.');
}

function response(statusCode: number, code: string, message: string): HttpException {
  return new HttpException({ statusCode, code, message }, statusCode);
}
