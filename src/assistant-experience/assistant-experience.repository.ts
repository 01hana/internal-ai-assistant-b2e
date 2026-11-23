import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { inc, rsort } from 'semver';
import { AssistantExperienceConfigSource, AssistantExperienceConfigStatus } from '../generated/prisma/enums';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { parseAssistantExperiencePayload } from './assistant-experience.parser';
import type { AssistantExperiencePayloadV1, ExperienceConfigError } from './assistant-experience.types';

export interface StoredExperienceConfig {
  readonly id: string;
  readonly customerId: string;
  readonly integrationId: string;
  readonly configVersion: string;
  readonly status: AssistantExperienceConfigStatus;
  readonly checksum: string;
  readonly source: AssistantExperienceConfigSource;
  readonly createdByUserId: string | null;
  readonly createdAt: Date;
  readonly activatedAt: Date | null;
  readonly payload: AssistantExperiencePayloadV1;
}

/** A stored version as listed, including versions whose payload no longer parses (`payload` null). */
export type ExperienceConfigVersion = Omit<StoredExperienceConfig, 'payload'> & Readonly<{
  payload: AssistantExperiencePayloadV1 | null;
  errors: readonly ExperienceConfigError[];
}>;

/** Feature 016: who wrote a version. Provisioning only supplies initial content. */
export type ExperienceConfigOrigin = Readonly<{ source: AssistantExperienceConfigSource; createdByUserId: string | null }>;

export const PROVISIONING_ORIGIN: ExperienceConfigOrigin = Object.freeze({
  source: AssistantExperienceConfigSource.provisioning, createdByUserId: null
});

/**
 * Feature 016: optimistic lock and same-transaction side effects (the admin audit) for a change of the active version.
 * `expectedActiveVersion` is the version the editor started from (null: none was active).
 */
export type ExperienceActivationGuard = Readonly<{
  expectedActiveVersion: string | null;
  afterActivate?: (tx: Prisma.TransactionClient, activated: StoredExperienceConfig) => Promise<void>;
}>;

/** The active version changed since the editor loaded it, or two saves raced (Feature 016). */
export class ExperienceConfigChangedError extends Error {
  constructor() {
    super('EXPERIENCE_CONFIG_CHANGED');
    this.name = 'ExperienceConfigChangedError';
  }
}

/** Persistence port used by provisioning; implemented by the Prisma repository and by test fakes. */
export interface AssistantExperienceConfigStore {
  customerExists(customerId: string): Promise<boolean>;
  findVersion(customerId: string, integrationId: string, configVersion: string): Promise<StoredExperienceConfig | null>;
  findActive(customerId: string, integrationId: string): Promise<StoredExperienceConfig | null>;
  /** Retires the current active row and activates `payload` (creating it if needed) in one transaction. */
  activate(payload: AssistantExperiencePayloadV1, checksum: string, origin?: ExperienceConfigOrigin): Promise<StoredExperienceConfig>;
}

export function experienceActiveSlot(customerId: string, integrationId: string): string {
  return `${customerId}/${integrationId}`;
}

/** Stable checksum: sorted-key JSON, so formatting or key order in the source file does not matter. */
export function experienceChecksum(payload: AssistantExperiencePayloadV1): string {
  return createHash('sha256').update(canonicalJson(payload)).digest('hex');
}

/** The next version after every stored one (patch increment); `1.0.0` for the first. */
export function nextExperienceVersion(versions: readonly string[]): string {
  const [latest] = rsort([...versions]);
  return latest ? (inc(latest, 'patch') as string) : '1.0.0';
}

@Injectable()
export class AssistantExperienceRepository implements AssistantExperienceConfigStore {
  constructor(private readonly prisma: PrismaService) {}

  async customerExists(customerId: string): Promise<boolean> {
    return (await this.prisma.db.customer.findUnique({ where: { id: customerId }, select: { id: true } })) !== null;
  }

  async findVersion(customerId: string, integrationId: string, configVersion: string): Promise<StoredExperienceConfig | null> {
    const row = await this.prisma.db.assistantExperienceConfig.findUnique({
      where: { customerId_integrationId_configVersion: { customerId, integrationId, configVersion } }
    });
    return row ? toStored(row) : null;
  }

  /** Returns null when there is no active row or the stored payload no longer parses (fail closed to defaults). */
  async findActive(customerId: string, integrationId: string): Promise<StoredExperienceConfig | null> {
    const row = await this.prisma.db.assistantExperienceConfig.findUnique({
      where: { activeSlot: experienceActiveSlot(customerId, integrationId) }
    });
    if (!row || row.customerId !== customerId || row.integrationId !== integrationId ||
      row.status !== AssistantExperienceConfigStatus.active) return null;
    return toStored(row);
  }

  /** Feature 016: one version, readable or not (the admin shows unreadable old versions as such). */
  async findVersionForReview(customerId: string, integrationId: string, configVersion: string): Promise<ExperienceConfigVersion | null> {
    const row = await this.prisma.db.assistantExperienceConfig.findUnique({
      where: { customerId_integrationId_configVersion: { customerId, integrationId, configVersion } }
    });
    return row ? toVersion(row) : null;
  }

  /** Feature 016: every stored version number of an integration, for `nextExperienceVersion`. */
  async listVersionNumbers(customerId: string, integrationId: string): Promise<string[]> {
    const rows = await this.prisma.db.assistantExperienceConfig.findMany({
      where: { customerId, integrationId }, select: { configVersion: true }
    });
    return rows.map((row) => row.configVersion);
  }

  async activate(payload: AssistantExperiencePayloadV1, checksum: string, origin: ExperienceConfigOrigin = PROVISIONING_ORIGIN): Promise<StoredExperienceConfig> {
    const { customerId, integrationId, configVersion } = payload;
    return this.changeActive(customerId, integrationId, undefined, (tx, activeSlot) =>
      tx.assistantExperienceConfig.upsert({
        where: { customerId_integrationId_configVersion: { customerId, integrationId, configVersion } },
        create: { ...newRow(payload, checksum, origin), activeSlot },
        update: { status: AssistantExperienceConfigStatus.active, activeSlot, activatedAt: new Date() }
      }));
  }

  /** Feature 016: stores a new version (never an existing one) and makes it active. */
  async saveVersion(payload: AssistantExperiencePayloadV1, checksum: string, origin: ExperienceConfigOrigin,
    guard: ExperienceActivationGuard): Promise<StoredExperienceConfig> {
    return this.changeActive(payload.customerId, payload.integrationId, guard, (tx, activeSlot) =>
      tx.assistantExperienceConfig.create({ data: { ...newRow(payload, checksum, origin), activeSlot } }));
  }

  /** Feature 016: makes a stored version active again; its origin is kept. */
  async reactivate(customerId: string, integrationId: string, configVersion: string,
    guard: ExperienceActivationGuard): Promise<StoredExperienceConfig> {
    return this.changeActive(customerId, integrationId, guard, (tx, activeSlot) =>
      tx.assistantExperienceConfig.update({
        where: { customerId_integrationId_configVersion: { customerId, integrationId, configVersion } },
        data: { status: AssistantExperienceConfigStatus.active, activeSlot, activatedAt: new Date() }
      }));
  }

  /** Retires the active row and activates another in one transaction; a concurrent change is EXPERIENCE_CONFIG_CHANGED. */
  private async changeActive(customerId: string, integrationId: string, guard: ExperienceActivationGuard | undefined,
    activateRow: (tx: Prisma.TransactionClient, activeSlot: string) => Promise<Row>): Promise<StoredExperienceConfig> {
    const activeSlot = experienceActiveSlot(customerId, integrationId);
    try {
      return await this.prisma.db.$transaction(async (tx) => {
        if (guard) {
          const current = await tx.assistantExperienceConfig.findUnique({ where: { activeSlot }, select: { configVersion: true } });
          if ((current?.configVersion ?? null) !== guard.expectedActiveVersion) throw new ExperienceConfigChangedError();
        }
        await tx.assistantExperienceConfig.updateMany({
          where: { customerId, integrationId, status: AssistantExperienceConfigStatus.active },
          data: { status: AssistantExperienceConfigStatus.retired, activeSlot: null }
        });
        const stored = toStored(await activateRow(tx, activeSlot));
        if (!stored) throw new Error('ASSISTANT_EXPERIENCE_STORED_PAYLOAD_INVALID');
        await guard?.afterActivate?.(tx, stored);
        return stored;
      });
    } catch (error) {
      // Two saves racing for the same version number or the active slot: the later one lost.
      if (guard && error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ExperienceConfigChangedError();
      throw error;
    }
  }
}

type Row = Readonly<{ id: string; customerId: string; integrationId: string; configVersion: string;
  status: AssistantExperienceConfigStatus; checksum: string; source: AssistantExperienceConfigSource; createdByUserId: string | null;
  createdAt: Date; activatedAt: Date | null; payload: unknown }>;

function newRow(payload: AssistantExperiencePayloadV1, checksum: string, origin: ExperienceConfigOrigin) {
  const { customerId, integrationId, configVersion } = payload;
  return { customerId, integrationId, configVersion, checksum, payload: payload as unknown as Prisma.InputJsonValue,
    status: AssistantExperienceConfigStatus.active, activatedAt: new Date(), ...origin };
}

function toVersion(row: Row): ExperienceConfigVersion {
  const parsed = parseAssistantExperiencePayload(row.payload);
  const errors = parsed.ok
    ? (parsed.payload.customerId !== row.customerId || parsed.payload.integrationId !== row.integrationId ||
      parsed.payload.configVersion !== row.configVersion ? [{ path: '$', code: 'SCOPE_MISMATCH' }] : [])
    : parsed.errors;
  return Object.freeze({ id: row.id, customerId: row.customerId, integrationId: row.integrationId,
    configVersion: row.configVersion, status: row.status, checksum: row.checksum, source: row.source,
    createdByUserId: row.createdByUserId, createdAt: row.createdAt, activatedAt: row.activatedAt,
    payload: parsed.ok && errors.length === 0 ? parsed.payload : null, errors: Object.freeze(errors) });
}

function toStored(row: Row): StoredExperienceConfig | null {
  const { payload, errors, ...meta } = toVersion(row);
  return payload && errors.length === 0 ? Object.freeze({ ...meta, payload }) : null;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
