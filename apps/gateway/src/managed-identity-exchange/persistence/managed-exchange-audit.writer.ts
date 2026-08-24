import type { Prisma } from '../../generated/prisma/client';
import { ManagedExchangeInfrastructureError, type ManagedExchangeAuditPort } from '../domain/managed-exchange.domain';
import { ManagedExchangeAuditRepository } from './managed-exchange.repository';

const INPUT_KEYS = ['requestId', 'outcome', 'reasonCode', 'integrationId', 'integrationConfigId', 'providerType', 'providerInstanceId', 'jti', 'kid'] as const;
const OUTCOMES = new Set(['success', 'denied', 'unavailable']);
const REASONS = new Set([
  'managed_exchange_issued',
  'managed_exchange_identity_invalid',
  'managed_exchange_identity_denied',
  'managed_exchange_unavailable',
  'managed_exchange_issuance_failed'
]);

/** Validates and projects one safe managed exchange lifecycle event. */
export class ManagedExchangeAuditWriter implements ManagedExchangeAuditPort {
  constructor(private readonly repository: Pick<ManagedExchangeAuditRepository, 'append'>) {}

  async append(input: Parameters<ManagedExchangeAuditPort['append']>[0]): Promise<void> {
    try {
      await this.repository.append(data(input));
    } catch {
      throw new ManagedExchangeInfrastructureError();
    }
  }
}

function data(value: unknown): Prisma.ManagedExchangeAuditEventCreateInput {
  if (!record(value) || !only(value, INPUT_KEYS) || !OUTCOMES.has(value.outcome as string) || !REASONS.has(value.reasonCode as string)) {
    throw new ManagedExchangeInfrastructureError();
  }
  const result: Prisma.ManagedExchangeAuditEventCreateInput = {
    requestId: text(value.requestId),
    outcome: value.outcome as 'success' | 'denied' | 'unavailable',
    reasonCode: text(value.reasonCode)
  };
  for (const key of ['integrationId', 'integrationConfigId', 'providerType', 'providerInstanceId', 'jti', 'kid'] as const) {
    if (value[key] !== undefined) Object.assign(result, { [key]: text(value[key]) });
  }
  return result;
}

function text(value: unknown): string {
  if (typeof value !== 'string' || value !== value.trim() || !value || control(value)) throw new ManagedExchangeInfrastructureError();
  return value;
}

function record(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function only(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Reflect.ownKeys(value).every((key) => typeof key === 'string' && keys.includes(key));
}

function control(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 31 || code === 127;
  });
}
