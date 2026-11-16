import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AssistantExperienceConfigStatus } from '../generated/prisma/enums';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { parseAssistantExperiencePayload } from './assistant-experience.parser';
import type { AssistantExperiencePayloadV1 } from './assistant-experience.types';

export interface StoredExperienceConfig {
  readonly id: string;
  readonly customerId: string;
  readonly integrationId: string;
  readonly configVersion: string;
  readonly status: AssistantExperienceConfigStatus;
  readonly checksum: string;
  readonly activatedAt: Date | null;
  readonly payload: AssistantExperiencePayloadV1;
}

/** Persistence port used by provisioning; implemented by the Prisma repository and by test fakes. */
export interface AssistantExperienceConfigStore {
  customerExists(customerId: string): Promise<boolean>;
  findVersion(customerId: string, integrationId: string, configVersion: string): Promise<StoredExperienceConfig | null>;
  findActive(customerId: string, integrationId: string): Promise<StoredExperienceConfig | null>;
  /** Retires the current active row and activates `payload` (creating it if needed) in one transaction. */
  activate(payload: AssistantExperiencePayloadV1, checksum: string): Promise<StoredExperienceConfig>;
}

export function experienceActiveSlot(customerId: string, integrationId: string): string {
  return `${customerId}/${integrationId}`;
}

/** Stable checksum: sorted-key JSON, so formatting or key order in the source file does not matter. */
export function experienceChecksum(payload: AssistantExperiencePayloadV1): string {
  return createHash('sha256').update(canonicalJson(payload)).digest('hex');
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

  async activate(payload: AssistantExperiencePayloadV1, checksum: string): Promise<StoredExperienceConfig> {
    const { customerId, integrationId, configVersion } = payload;
    const activeSlot = experienceActiveSlot(customerId, integrationId);
    const row = await this.prisma.db.$transaction(async (tx) => {
      await tx.assistantExperienceConfig.updateMany({
        where: { customerId, integrationId, status: AssistantExperienceConfigStatus.active },
        data: { status: AssistantExperienceConfigStatus.retired, activeSlot: null }
      });
      return tx.assistantExperienceConfig.upsert({
        where: { customerId_integrationId_configVersion: { customerId, integrationId, configVersion } },
        create: { customerId, integrationId, configVersion, checksum, payload: payload as unknown as Prisma.InputJsonValue,
          status: AssistantExperienceConfigStatus.active, activeSlot, activatedAt: new Date() },
        update: { status: AssistantExperienceConfigStatus.active, activeSlot, activatedAt: new Date() }
      });
    });
    const stored = toStored(row);
    if (!stored) throw new Error('ASSISTANT_EXPERIENCE_STORED_PAYLOAD_INVALID');
    return stored;
  }
}

type Row = Readonly<{ id: string; customerId: string; integrationId: string; configVersion: string;
  status: AssistantExperienceConfigStatus; checksum: string; activatedAt: Date | null; payload: unknown }>;

function toStored(row: Row): StoredExperienceConfig | null {
  const parsed = parseAssistantExperiencePayload(row.payload);
  if (!parsed.ok || parsed.payload.customerId !== row.customerId || parsed.payload.integrationId !== row.integrationId ||
    parsed.payload.configVersion !== row.configVersion) return null;
  return Object.freeze({ id: row.id, customerId: row.customerId, integrationId: row.integrationId,
    configVersion: row.configVersion, status: row.status, checksum: row.checksum, activatedAt: row.activatedAt,
    payload: parsed.payload });
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
