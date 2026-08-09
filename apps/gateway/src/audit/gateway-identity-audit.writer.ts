import type { Prisma, PrismaClient } from '../generated/prisma/client';

type GatewayIdentityAuditDelegate = Pick<PrismaClient, 'gatewayIdentityAuditEvent'>;
export type GatewayIdentityAuditClient = GatewayIdentityAuditDelegate | Pick<Prisma.TransactionClient, 'gatewayIdentityAuditEvent'>;

/** A deliberately small safe decision record; no metadata or payload bag is accepted. */
export type AppendGatewayIdentityAuditEventInput = Readonly<{
  requestId: string;
  eventType: string;
  outcome: string;
  reasonCode: string;
  customerId?: string;
  integrationId?: string;
  actorId?: string;
  hostApp?: string;
  jti?: string;
  kid?: string;
}>;

export class GatewayIdentityAuditWriter {
  constructor(private readonly client: GatewayIdentityAuditClient) {}

  async append(input: AppendGatewayIdentityAuditEventInput) {
    const data = {
      requestId: required(input.requestId),
      eventType: safeCode(input.eventType),
      outcome: safeCode(input.outcome),
      reasonCode: safeCode(input.reasonCode),
      customerId: optional(input.customerId),
      integrationId: optional(input.integrationId),
      actorId: optional(input.actorId),
      hostApp: optional(input.hostApp),
      jti: optional(input.jti),
      kid: optional(input.kid)
    };
    return this.client.gatewayIdentityAuditEvent.create({ data });
  }
}

function required(value: string): string {
  const normalized = optional(value);
  if (!normalized) throw new GatewayIdentityAuditInputError();
  return normalized;
}

function optional(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (!normalized || containsControlCharacter(normalized)) throw new GatewayIdentityAuditInputError();
  return normalized;
}

function safeCode(value: string): string {
  const normalized = required(value);
  if (!/^[a-z][a-z0-9_:-]{0,127}$/.test(normalized)) throw new GatewayIdentityAuditInputError();
  return normalized;
}

export class GatewayIdentityAuditInputError extends Error {
  constructor() {
    super('Invalid Gateway identity audit input.');
  }
}

function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 31 || code === 127;
  });
}
