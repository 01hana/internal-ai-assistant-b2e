import type { CanonicalParameterValueV1 } from '../capabilities/capability-pack.types';

/** Generic Core greeting used when an integration has no active experience configuration. */
export const DEFAULT_ASSISTANT_GREETING = '你好，我是系統內的 AI 助理，可以依你的權限協助查詢資料。';

/** Feature 013 experience configuration payload v1. Customer text lives in customers/<customer>/assistant-experience/. */
export type SemanticReviewStatus = 'NEEDS_HUMAN_REVIEW' | 'HUMAN_VERIFIED';

export interface PageScopeV1 {
  readonly modules: readonly string[];
}

interface QuickReplyBaseV1 {
  readonly id: string;
  readonly label: string;
  /** Text stored as the user's message when the Quick Reply is selected. */
  readonly message: string;
  readonly priority: number;
  readonly pageScope?: PageScopeV1;
}

export interface CapabilityQuickReplyV1 extends QuickReplyBaseV1 {
  readonly kind: 'capability';
  readonly capabilityKey: string;
  readonly parameters?: Readonly<Record<string, CanonicalParameterValueV1>>;
}

export interface CapabilityOverviewQuickReplyV1 extends QuickReplyBaseV1 {
  readonly kind: 'capability_overview';
}

export type QuickReplyV1 = CapabilityQuickReplyV1 | CapabilityOverviewQuickReplyV1;

export interface FollowUpV1 {
  readonly id: string;
  readonly whenCapabilityKey: string;
  /** Subset of the answered request's parameters that must match; omitted means any. */
  readonly whenParameters?: Readonly<Record<string, CanonicalParameterValueV1>>;
  readonly label: string;
  readonly message: string;
  readonly capabilityKey: string;
  readonly parameters?: Readonly<Record<string, CanonicalParameterValueV1>>;
}

export interface AssistantExperiencePayloadV1 {
  readonly version: '1';
  readonly configVersion: string;
  readonly customerId: string;
  readonly integrationId: string;
  readonly hostApps: readonly string[];
  readonly locale: string;
  readonly semanticReviewStatus: SemanticReviewStatus;
  readonly greeting: Readonly<{ text: string }>;
  readonly maxQuickReplies: number;
  readonly quickReplies: readonly QuickReplyV1[];
  readonly followUps: readonly FollowUpV1[];
}

export interface ExperienceConfigError {
  /** JSON path such as `$.quickReplies[1].label`; never contains configuration text. */
  readonly path: string;
  readonly code: string;
}

export type ExperienceParseResult =
  | { readonly ok: true; readonly payload: AssistantExperiencePayloadV1 }
  | { readonly ok: false; readonly errors: readonly ExperienceConfigError[] };

/** Shape returned to clients for Quick Replies and suggestions. */
export interface ExperienceChoiceV1 {
  readonly id: string;
  readonly label: string;
}

export const EXPERIENCE_LIMITS = Object.freeze({
  idPattern: /^[a-z0-9][a-z0-9._-]{0,63}$/,
  versionPattern: /^\d+\.\d+\.\d+$/,
  scopeValueMaxLength: 128,
  greetingMaxLength: 500,
  labelMaxLength: 40,
  messageMaxLength: 200,
  maxQuickRepliesRange: [1, 6] as const,
  quickRepliesMax: 20,
  followUpsMax: 50,
  priorityRange: [0, 1000] as const,
  pageModulesMax: 20,
  moduleMaxLength: 64,
  parametersMax: 8,
  parameterStringMaxLength: 64
});
