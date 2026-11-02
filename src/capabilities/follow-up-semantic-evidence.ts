import type { CapabilityDefinitionV1, ScopedCapabilityCatalogV1 } from './capability-pack.types';
import { normalizeCapabilitySemanticText } from './capability-semantic-resolver.service';
import { validateCapabilityCanonicalValue } from './capability-parameter-resolver.service';

export type FollowUpSemanticEvidenceDecision =
  | Readonly<{ kind: 'REUSE' }>
  | Readonly<{ kind: 'SWITCH'; capability: CapabilityDefinitionV1; semanticText: string }>
  | Readonly<{ kind: 'CLARIFY'; reasonCode: 'FOLLOW_UP_TARGET_UNVERIFIED' }>;

const FILLERS = ['那個', '同樣', '一樣', '查詢', '幫我', '這個', '那', '呢', '請', '再', '查', '看', '的', '嗎'];

export type ExplicitPriorEvidenceRecall = Readonly<{
  kind: 'TOOL' | 'HYBRID';
  toolTarget: string;
  documentTarget?: string;
}>;

/** Classifies a request to restate prior evidence; it does not grant reuse or execution authority. */
export function extractExplicitPriorEvidenceRecall(text: string): ExplicitPriorEvidenceRecall | undefined {
  const normalized = normalizeCapabilitySemanticText(text);
  const tool = /^你剛說(.+?)是多少$/.exec(normalized);
  if (tool?.[1]?.trim()) return Object.freeze({ kind: 'TOOL', toolTarget: tool[1].trim() });
  const hybrid = /^把剛才的(.+?)和(.+?)證據再列一次$/.exec(normalized);
  if (hybrid?.[1]?.trim() && hybrid[2]?.trim()) {
    return Object.freeze({ kind: 'HYBRID', toolTarget: hybrid[1].trim(), documentTarget: hybrid[2].trim() });
  }
  return undefined;
}

/** A bare recall pronoun is not enough to identify the previous Capability. */
export function hasPriorCapabilityTargetSignal(capability: CapabilityDefinitionV1, text: string): boolean {
  const profile = capability.semanticProfiles.find((entry) => entry.locale === 'zh-TW');
  const normalized = normalizeCapabilitySemanticText(text);
  return Boolean(profile && [...profile.aliases, ...profile.resourceTerms, ...profile.metricTerms,
    ...(capability.followUpSemanticEvidence?.targetTerms ?? [])]
    .some((term) => normalized.includes(normalizeCapabilitySemanticText(term))));
}

export function resolveFollowUpSemanticEvidence(input: Readonly<{
  catalog: ScopedCapabilityCatalogV1;
  priorCapability: CapabilityDefinitionV1;
  text: string;
  timeRanges: readonly Readonly<{ label: string; source: string }>[];
  exactlyRepeatedMetricTerms?: readonly string[];
}>): FollowUpSemanticEvidenceDecision {
  let remaining = normalizeCapabilitySemanticText(input.text);
  if (remaining.length === 0) return clarify();
  const matched = new Set<string>();
  const targets = input.catalog.capabilities.flatMap((capability) => {
    const profile = capability.semanticProfiles.find((entry) => entry.locale === 'zh-TW');
    return [...(capability.followUpSemanticEvidence?.targetTerms ?? []), ...(profile?.aliases ?? [])]
      .map((term) => ({ capability, term: normalizeCapabilitySemanticText(term) }));
  }).sort((left, right) => right.term.length - left.term.length);
  for (const target of targets) {
    if (!target.term || !remaining.includes(target.term)) continue;
    matched.add(target.capability.capabilityKey);
    remaining = remove(remaining, target.term);
  }
  if (matched.size > 1) return clarify();

  const targetKey = [...matched][0];
  const target = targetKey ? input.catalog.capabilities.find((entry) => entry.capabilityKey === targetKey) : input.priorCapability;
  if (!target) return clarify();
  if (input.timeRanges.length > 1 || input.timeRanges.some((range) =>
    !target.parameters.some((parameter) => parameter.type === 'enum' &&
      parameter.values.some((value) => value.value === range.label)))) return clarify();
  for (const range of input.timeRanges) remaining = remove(remaining, normalizeCapabilitySemanticText(range.source));
  if (target.capabilityKey === input.priorCapability.capabilityKey) {
    for (const term of [...(input.exactlyRepeatedMetricTerms ?? [])].sort((a, b) => b.length - a.length)) {
      remaining = remove(remaining, normalizeCapabilitySemanticText(term));
    }
  }
  const profile = target.semanticProfiles.find((entry) => entry.locale === 'zh-TW');
  if (!profile) return clarify();
  for (const term of [...profile.resourceTerms, ...profile.intentTerms]) {
    remaining = remove(remaining, normalizeCapabilitySemanticText(term));
  }
  for (const parameter of target.parameters) {
    for (const term of parameter.semanticTerms) remaining = remove(remaining, normalizeCapabilitySemanticText(term));
    if (parameter.type === 'enum') {
      for (const value of parameter.values) {
        for (const alias of value.aliases) remaining = remove(remaining, normalizeCapabilitySemanticText(alias));
      }
    } else {
      for (const token of input.text.match(/[A-Za-z][A-Za-z0-9._:-]*/g) ?? []) {
        if (validateCapabilityCanonicalValue(parameter, token) !== undefined) remaining = remove(remaining, normalizeCapabilitySemanticText(token));
      }
    }
  }
  for (const filler of FILLERS) remaining = remove(remaining, filler);
  if (remaining.replace(/\s+/g, '').length > 0) return clarify();
  if (target.capabilityKey === input.priorCapability.capabilityKey) return Object.freeze({ kind: 'REUSE' });
  return Object.freeze({ kind: 'SWITCH', capability: target, semanticText: `${profile.aliases[0]} ${input.text}` });
}

function remove(text: string, term: string): string {
  return term.length > 0 ? text.replaceAll(term, ' ').replace(/\s+/g, ' ').trim() : text;
}

function clarify(): FollowUpSemanticEvidenceDecision {
  return Object.freeze({ kind: 'CLARIFY', reasonCode: 'FOLLOW_UP_TARGET_UNVERIFIED' });
}
