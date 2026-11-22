import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { parseAssistantExperiencePayload } from '../../assistant-experience/assistant-experience.parser';
import {
  AssistantExperienceRepository,
  ExperienceConfigChangedError,
  experienceChecksum,
  nextExperienceVersion,
  type StoredExperienceConfig
} from '../../assistant-experience/assistant-experience.repository';
import {
  type AssistantExperiencePayloadV1,
  DEFAULT_ASSISTANT_GREETING,
  type ExperienceConfigError
} from '../../assistant-experience/assistant-experience.types';
import { AssistantExperienceValidator } from '../../assistant-experience/assistant-experience.validator';
import { CapabilityCatalogRegistry } from '../../capabilities/capability-catalog.registry';
import type { ScopedCapabilityCatalogV1 } from '../../capabilities/capability-pack.types';
import { PrismaService } from '../../prisma/prisma.service';
import { auditActorView, type AuditActorView } from '../audit/audit-actor';
import { UserAuditService } from '../audit/user-audit.service';
import { actorOf } from '../auth/admin-auth.service';
import { isDeveloper } from '../authorization/admin-ability.factory';
import type { AdminPrincipal } from '../common/admin-request';
import type { RequestMeta } from '../common/request-meta';
import { AdminSettings } from '../config/admin-settings';
import { experienceCatalog } from './experience-catalog';
import type { ExperienceConfigInputDto } from './experience-configs.dto';

const NOT_FOUND = { error: 'integration_not_found', message: '找不到這個整合。' };
const CHANGED = { error: 'experience_config_changed', message: '體驗設定已被其他人修改，請重新載入後再編輯。' };
const INVALID = { error: 'experience_config_invalid', message: '體驗設定有錯誤，請修正後再儲存。' };
const DEFAULT_LOCALE = 'zh-TW';

type Integration = Readonly<{ integrationId: string; allowedHostApp: string }>;
type Prepared = Readonly<{ errors: readonly ExperienceConfigError[]; payload?: AssistantExperiencePayloadV1 }>;

/**
 * Feature 016: experience configurations of this customer's integrations. Saving stores a new version and makes it
 * active at once (spec Decision 2); every rule comes from Feature 013's parser and validator.
 */
@Injectable()
export class ExperienceConfigsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: AdminSettings,
    private readonly configs: AssistantExperienceRepository,
    private readonly validator: AssistantExperienceValidator,
    private readonly registry: CapabilityCatalogRegistry,
    private readonly audit: UserAuditService
  ) {}

  async integrations() {
    const bindings = await this.prisma.db.integrationBinding.findMany({
      where: { customerId: this.settings.customerId, enabled: true }, orderBy: { integrationId: 'asc' }
    });
    return Promise.all(bindings.map(async (binding) => {
      const active = await this.configs.findActive(this.settings.customerId, binding.integrationId);
      return {
        integrationId: binding.integrationId,
        hostApps: hostAppsOf(binding, active),
        current: active ? { configVersion: active.configVersion, source: active.source, activatedAt: active.activatedAt } : null
      };
    }));
  }

  async get(principal: AdminPrincipal, integrationId: string) {
    const integration = await this.integration(integrationId);
    return this.view(principal, integration, await this.configs.findActive(this.settings.customerId, integrationId));
  }

  async catalog(integrationId: string) {
    const integration = await this.integration(integrationId);
    const hostApps = hostAppsOf(integration, await this.configs.findActive(this.settings.customerId, integrationId));
    const catalogs = this.catalogsOf(integrationId, hostApps);
    return catalogs
      ? { available: true, hostApps, capabilities: experienceCatalog(catalogs) }
      : { available: false, hostApps, capabilities: [] };
  }

  /** Same checks as saving, without writing. */
  async validate(integrationId: string, input: ExperienceConfigInputDto) {
    const integration = await this.integration(integrationId);
    const active = await this.configs.findActive(this.settings.customerId, integrationId);
    const { errors } = await this.prepare(integration, active, input);
    return { valid: errors.length === 0, errors };
  }

  async save(principal: AdminPrincipal, integrationId: string, input: ExperienceConfigInputDto, meta: RequestMeta) {
    const integration = await this.integration(integrationId);
    const active = await this.configs.findActive(this.settings.customerId, integrationId);
    if ((active?.configVersion ?? null) !== input.baseConfigVersion) throw new ConflictException(CHANGED);
    const { errors, payload } = await this.prepare(integration, active, input);
    if (!payload) throw new UnprocessableEntityException({ ...INVALID, details: { errors } });

    if (active && experienceChecksum({ ...payload, configVersion: active.configVersion }) === active.checksum) {
      return { unchanged: true, ...(await this.view(principal, integration, active)) };
    }
    const actor = actorOf(principal.user);
    try {
      const saved = await this.configs.saveVersion(payload, experienceChecksum(payload), { source: 'admin', createdByUserId: actor.id }, {
        expectedActiveVersion: input.baseConfigVersion,
        afterActivate: (tx, stored) => this.audit.record({
          eventType: 'admin_experience_config_saved', meta, actor, target: { type: 'ExperienceConfig', id: stored.id },
          metadata: { integrationId, configVersion: stored.configVersion, previousVersion: input.baseConfigVersion,
            quickReplies: payload.quickReplies.length, followUps: payload.followUps.length }
        }, tx)
      });
      return { unchanged: false, ...(await this.view(principal, integration, saved)) };
    } catch (error) {
      if (error instanceof ExperienceConfigChangedError) throw new ConflictException(CHANGED);
      throw error;
    }
  }

  /** A version is built from the active one's HostApps and locale; on the first save, from the integration binding. */
  private async prepare(integration: Integration, active: StoredExperienceConfig | null, input: ExperienceConfigInputDto): Promise<Prepared> {
    const versions = await this.configs.listVersionNumbers(this.settings.customerId, integration.integrationId);
    const parsed = parseAssistantExperiencePayload({
      version: '1',
      configVersion: nextExperienceVersion(versions),
      customerId: this.settings.customerId,
      integrationId: integration.integrationId,
      hostApps: hostAppsOf(integration, active),
      locale: active?.payload.locale ?? DEFAULT_LOCALE,
      // Written by a back-office user, who is the human reviewer (Feature 013 semanticReviewStatus).
      semanticReviewStatus: 'HUMAN_VERIFIED',
      greeting: input.greeting,
      maxQuickReplies: input.maxQuickReplies,
      ...withIds(input.quickReplies, input.followUps)
    });
    if (!parsed.ok) return { errors: parsed.errors };
    const errors = await this.validator.validate(parsed.payload);
    return errors.length > 0 ? { errors } : { errors: [], payload: parsed.payload };
  }

  private async view(principal: AdminPrincipal, integration: Integration, active: StoredExperienceConfig | null) {
    const { integrationId } = integration;
    if (!active) return { integrationId, hostApps: hostAppsOf(integration, null), defaultGreeting: DEFAULT_ASSISTANT_GREETING, config: null };
    const { greeting, maxQuickReplies, quickReplies, followUps } = active.payload;
    return {
      integrationId,
      hostApps: active.payload.hostApps,
      defaultGreeting: DEFAULT_ASSISTANT_GREETING,
      config: {
        configVersion: active.configVersion, source: active.source, createdBy: await this.creatorOf(principal, active.createdByUserId),
        activatedAt: active.activatedAt, greeting, maxQuickReplies, quickReplies, followUps
      }
    };
  }

  /** Developers stay anonymous to everyone but developers (Feature 014 US5-3). Provisioning has no creator. */
  private async creatorOf(principal: AdminPrincipal, userId: string | null): Promise<AuditActorView | null> {
    if (!userId) return null;
    const user = await this.prisma.db.user.findUnique({ where: { id: userId }, include: { groups: true } });
    return auditActorView({ actorAccount: user?.account ?? null, actorIsDeveloper: user ? isDeveloper(user.groups) : false }, principal.isDeveloper);
  }

  private async integration(integrationId: string): Promise<Integration> {
    const binding = await this.prisma.db.integrationBinding.findFirst({
      where: { integrationId, customerId: this.settings.customerId, enabled: true }, select: { integrationId: true, allowedHostApp: true }
    });
    if (!binding) throw new NotFoundException(NOT_FOUND);
    return binding;
  }

  /** Null when a HostApp has no loaded pack (the validator then reports NO_ACTIVE_PACK). */
  private catalogsOf(integrationId: string, hostApps: readonly string[]): ScopedCapabilityCatalogV1[] | null {
    const catalogs: ScopedCapabilityCatalogV1[] = [];
    for (const hostApp of hostApps) {
      const resolved = this.registry.resolveCatalog({ customerId: this.settings.customerId, integrationId, hostApp });
      if (!resolved.available) return null;
      catalogs.push(resolved.catalog);
    }
    return catalogs;
  }
}

function hostAppsOf(integration: Integration, active: StoredExperienceConfig | null): readonly string[] {
  return active?.payload.hostApps ?? [integration.allowedHostApp];
}

/** New Quick Replies and follow-ups get an ID (`qr-…`, `fu-…`); IDs share one namespace in the payload. */
function withIds(quickReplies: Record<string, unknown>[], followUps: Record<string, unknown>[]) {
  const used = new Set([...quickReplies, ...followUps].map((item) => item.id).filter((id): id is string => typeof id === 'string' && id !== ''));
  const assign = (prefix: string) => (item: Record<string, unknown>) => {
    if (typeof item.id === 'string' && item.id !== '') return item;
    let id: string;
    do id = `${prefix}-${randomBytes(4).readUInt32BE().toString(36).padStart(6, '0').slice(-6)}`; while (used.has(id));
    used.add(id);
    return { ...item, id };
  };
  return { quickReplies: quickReplies.map(assign('qr')), followUps: followUps.map(assign('fu')) };
}
