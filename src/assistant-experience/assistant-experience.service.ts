import { Injectable } from '@nestjs/common';
import { acceptsDeclared, AvailableBindingV1, AvailableCapabilityService } from '../capabilities/available-capability.service';
import type { CanonicalParameterValueV1 } from '../capabilities/capability-pack.types';
import type { HostIntegrationContext } from '../host-integration/host-integration.types';
import type { DeclaredChoiceV1 } from '../query-understanding/query-understanding.types';
import type { NormalizedPageContext } from '../assistant/page-context/page-context.types';
import { AssistantExperienceRepository } from './assistant-experience.repository';
import type { ExperienceChoiceV1, QuickReplyV1 } from './assistant-experience.types';

/** Generic Core greeting used when an integration has no active experience configuration. */
export const DEFAULT_ASSISTANT_GREETING = '你好，我是系統內的 AI 助理，可以依你的權限協助查詢資料。';

export interface AssistantOpeningV1 {
  readonly configVersion: string | null;
  readonly greeting: string;
  readonly quickReplies: readonly ExperienceChoiceV1[];
}

export interface ResolvedExperienceChoice {
  readonly choiceId: string;
  readonly source: 'quick_reply' | 'suggestion';
  readonly configVersion: string;
  /** Stored as the user's message. */
  readonly message: string;
  readonly declared: DeclaredChoiceV1;
}

/**
 * Feature 013 US1: builds the session opening and resolves clicked choices. Visibility always comes
 * from AvailableCapabilityService; page scope is a display filter only and is not re-checked on click.
 */
@Injectable()
export class AssistantExperienceService {
  constructor(
    private readonly configs: AssistantExperienceRepository,
    private readonly available: AvailableCapabilityService
  ) {}

  async buildOpening(host: HostIntegrationContext, pageContext?: NormalizedPageContext): Promise<AssistantOpeningV1> {
    const active = await this.configs.findActive(host.customerId, host.integrationId);
    if (!active || !active.payload.hostApps.includes(host.hostApp)) {
      return Object.freeze({ configVersion: null, greeting: DEFAULT_ASSISTANT_GREETING, quickReplies: Object.freeze([]) });
    }
    const payload = active.payload;
    const { bindings } = await this.available.resolveAvailableBindings(host);
    const quickReplies = payload.quickReplies
      .filter((reply) => inPageScope(reply, pageContext?.module) && quickReplyVisible(reply, bindings))
      .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id, 'en-US'))
      .slice(0, payload.maxQuickReplies)
      .map(toChoice);
    return Object.freeze({ configVersion: payload.configVersion, greeting: payload.greeting.text, quickReplies: Object.freeze(quickReplies) });
  }

  /**
   * Feature 013 US2: capability Quick Replies the actor may run, ignoring page scope, up to maxQuickReplies.
   * Used as suggestions after a capability overview or an unrecognized question.
   */
  async buildCapabilityQuickReplies(host: HostIntegrationContext): Promise<readonly ExperienceChoiceV1[]> {
    const active = await this.configs.findActive(host.customerId, host.integrationId);
    if (!active || !active.payload.hostApps.includes(host.hostApp)) return Object.freeze([]);
    const { bindings } = await this.available.resolveAvailableBindings(host);
    return Object.freeze(active.payload.quickReplies
      .filter((reply) => reply.kind === 'capability' && quickReplyVisible(reply, bindings))
      .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id, 'en-US'))
      .slice(0, active.payload.maxQuickReplies)
      .map(toChoice));
  }

  /**
   * Feature 013 US3: follow-ups for a successfully answered capability. A follow-up applies when its
   * `whenCapabilityKey` matches and every `whenParameters` entry equals the answered parameter; it is dropped
   * when it would repeat the same request or the actor may not run it. Configuration order, at most 3.
   */
  async buildFollowUps(host: HostIntegrationContext, capabilityKey: string,
    parameters: Readonly<Record<string, CanonicalParameterValueV1>>): Promise<readonly ExperienceChoiceV1[]> {
    const active = await this.configs.findActive(host.customerId, host.integrationId);
    if (!active || !active.payload.hostApps.includes(host.hostApp)) return Object.freeze([]);
    const candidates = active.payload.followUps.filter((item) => item.whenCapabilityKey === capabilityKey &&
      Object.entries(item.whenParameters ?? {}).every(([name, value]) => parameters[name] === value) &&
      !(item.capabilityKey === capabilityKey && sameParameters(item.parameters ?? {}, parameters)));
    if (candidates.length === 0) return Object.freeze([]);
    const { bindings } = await this.available.resolveAvailableBindings(host);
    return Object.freeze(candidates
      .filter((item) => acceptsDeclared(bindings, item.capabilityKey, item.parameters ?? {}))
      .slice(0, MAX_FOLLOW_UPS)
      .map((item) => Object.freeze({ id: item.id, label: item.label })));
  }

  /** Returns null when the ID is unknown, not in the active configuration, or no longer permitted. */
  async resolveChoice(host: HostIntegrationContext, choiceId: string): Promise<ResolvedExperienceChoice | null> {
    const active = await this.configs.findActive(host.customerId, host.integrationId);
    if (!active || !active.payload.hostApps.includes(host.hostApp)) return null;
    const payload = active.payload;
    const reply = payload.quickReplies.find((item) => item.id === choiceId);
    const followUp = reply ? undefined : payload.followUps.find((item) => item.id === choiceId);
    if (!reply && !followUp) return null;
    const { bindings } = await this.available.resolveAvailableBindings(host);
    if (reply) {
      if (!quickReplyVisible(reply, bindings)) return null;
      return Object.freeze({ choiceId, source: 'quick_reply' as const, configVersion: payload.configVersion, message: reply.message,
        declared: reply.kind === 'capability_overview'
          ? Object.freeze({ kind: 'capability_overview' as const })
          : Object.freeze({ kind: 'capability' as const, capabilityKey: reply.capabilityKey, parameters: Object.freeze({ ...(reply.parameters ?? {}) }) }) });
    }
    if (!followUp || !acceptsDeclared(bindings, followUp.capabilityKey, followUp.parameters ?? {})) return null;
    return Object.freeze({ choiceId, source: 'suggestion' as const, configVersion: payload.configVersion, message: followUp.message,
      declared: Object.freeze({ kind: 'capability' as const, capabilityKey: followUp.capabilityKey,
        parameters: Object.freeze({ ...(followUp.parameters ?? {}) }) }) });
  }
}

const MAX_FOLLOW_UPS = 3;

function sameParameters(left: Readonly<Record<string, CanonicalParameterValueV1>>,
  right: Readonly<Record<string, CanonicalParameterValueV1>>): boolean {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...keys].every((key) => left[key] === right[key]);
}

function quickReplyVisible(reply: QuickReplyV1, bindings: readonly AvailableBindingV1[]): boolean {
  return reply.kind === 'capability_overview'
    ? bindings.length > 0
    : acceptsDeclared(bindings, reply.capabilityKey, reply.parameters ?? {});
}

function inPageScope(reply: QuickReplyV1, module: string | undefined): boolean {
  return !reply.pageScope || (module !== undefined && reply.pageScope.modules.includes(module));
}

function toChoice(reply: QuickReplyV1): ExperienceChoiceV1 {
  return Object.freeze({ id: reply.id, label: reply.label });
}
