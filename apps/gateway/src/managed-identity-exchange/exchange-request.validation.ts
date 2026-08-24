import { randomUUID } from 'node:crypto';
import { ManagedExchangeRequestError } from './domain/managed-exchange.domain';

export type ManagedExchangeHttpRequest = Readonly<{
  integrationSelector: string;
  nativeCredential: string;
  requestId: string;
}>;

export function validateManagedExchangeRequest(value: Readonly<{
  authorization: unknown;
  requestId: unknown;
  body: unknown;
}>): ManagedExchangeHttpRequest {
  return Object.freeze({
    integrationSelector: readIntegrationSelector(value.body),
    nativeCredential: extractManagedExchangeBearer(value.authorization),
    requestId: normalizeManagedExchangeRequestId(value.requestId)
  });
}

export function extractManagedExchangeBearer(value: unknown): string {
  if (typeof value !== 'string') throw new ManagedExchangeRequestError();
  const match = /^Bearer ([^\s]+)$/.exec(value);
  if (!match) throw new ManagedExchangeRequestError();
  return match[1];
}

export function normalizeManagedExchangeRequestId(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value : randomUUID();
}

function readIntegrationSelector(value: unknown): string {
  if (!plainRecord(value)) throw new ManagedExchangeRequestError();
  const keys = Object.keys(value);
  if (keys.length !== 1 || keys[0] !== 'integrationSelector') throw new ManagedExchangeRequestError();
  return text(value.integrationSelector);
}

function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || control(value)) throw new ManagedExchangeRequestError();
  return value;
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function control(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 31 || code === 127;
  });
}
