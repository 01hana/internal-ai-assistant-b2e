import { Injectable } from '@nestjs/common';
import {
  MAX_AMBIGUOUS_CANDIDATE_REFS,
  MAX_CANDIDATES_MATERIALIZED
} from './capability-pack.parser';
import type {
  CapabilityDefinitionV1,
  CapabilityRefV1,
  CapabilityResolutionResultV1,
  CapabilitySemanticMetadataV1,
  ScopedCapabilityCatalogV1,
  SemanticSignalGroup
} from './capability-pack.types';

export const CAPABILITY_SEMANTIC_LOCALE = 'zh-TW';
export const CAPABILITY_SCORE_THRESHOLD = 0.70;
export const CAPABILITY_AMBIGUITY_DELTA = 0.05;
export const CAPABILITY_SEMANTIC_WEIGHTS = Object.freeze({
  alias: 0.35,
  requiredSignals: 0.35,
  optionalSignals: 0.10,
  example: 0.10,
  parameters: 0.10
});

const MAX_SEMANTIC_INPUT_LENGTH = 4_000;

export type CapabilitySemanticResolutionResult =
  | Readonly<{
      outcome: 'MATCHED';
      capability: CapabilityRefV1;
      score: number;
      validatedParameterNames: readonly string[];
    }>
  | Extract<CapabilityResolutionResultV1, { outcome: 'NEEDS_CLARIFICATION' | 'AMBIGUOUS' }>;

export interface CapabilitySemanticResolutionInput {
  readonly catalog: ScopedCapabilityCatalogV1;
  readonly text: string;
  readonly validatedParameterSignalsByCapability?: Readonly<Record<string, readonly string[]>>;
}

@Injectable()
export class CapabilitySemanticResolverService {
  resolve(input: CapabilitySemanticResolutionInput): CapabilitySemanticResolutionResult {
    const normalizedText = normalizeCapabilitySemanticText(input.text);
    if (normalizedText.length === 0 || input.text.length > MAX_SEMANTIC_INPUT_LENGTH) return notRecognized();

    const eligible: ScoredCandidate[] = [];
    const ordered = [...input.catalog.capabilities]
      .filter((capability) => capability.active)
      .sort((left, right) => left.capabilityKey.localeCompare(right.capabilityKey, 'en-US'));
    for (const capability of ordered) {
      const profile = capability.semanticProfiles.find((candidate) => candidate.locale === CAPABILITY_SEMANTIC_LOCALE);
      if (!profile || !requiredGroupsMatch(profile, normalizedText)) continue;
      eligible.push(scoreCandidate(
        input.catalog,
        capability,
        profile,
        normalizedText,
        input.validatedParameterSignalsByCapability?.[capability.capabilityKey] ?? []
      ));
      if (eligible.length > MAX_CANDIDATES_MATERIALIZED) return notRecognized();
    }

    const ranked = eligible.sort((left, right) => right.score - left.score ||
      left.capability.capabilityKey.localeCompare(right.capability.capabilityKey, 'en-US'));
    const top = ranked[0];
    if (!top || top.score < CAPABILITY_SCORE_THRESHOLD) return notRecognized();
    const tied = ranked.filter((candidate) => top.score - candidate.score <= CAPABILITY_AMBIGUITY_DELTA);
    if (tied.length > 1) {
      return Object.freeze({
        version: '1' as const,
        outcome: 'AMBIGUOUS' as const,
        reasonCode: 'MULTIPLE_CAPABILITIES' as const,
        candidates: Object.freeze(tied
          .map((candidate) => candidate.capability)
          .sort((left, right) => left.capabilityKey.localeCompare(right.capabilityKey, 'en-US'))
          .slice(0, MAX_AMBIGUOUS_CANDIDATE_REFS))
      });
    }
    return Object.freeze({
      outcome: 'MATCHED' as const,
      capability: top.capability,
      score: top.score,
      validatedParameterNames: top.validatedParameterNames
    });
  }
}

interface ScoredCandidate {
  readonly capability: CapabilityRefV1;
  readonly score: number;
  readonly validatedParameterNames: readonly string[];
}

function scoreCandidate(
  catalog: ScopedCapabilityCatalogV1,
  capability: CapabilityDefinitionV1,
  profile: CapabilitySemanticMetadataV1,
  normalizedText: string,
  signaledParameters: readonly string[]
): ScoredCandidate {
  const required = profile.requiredSignalGroups;
  const optional = (['resource', 'intent', 'metric'] as const).filter((group) => !required.includes(group));
  const validatedParameterNames = [...new Set(signaledParameters)]
    .filter((name) => capability.parameters.some((parameter) => parameter.parameterName === name))
    .sort((left, right) => left.localeCompare(right, 'en-US'));
  const aliasCoverage = maximum(profile.aliases.map((alias) => phraseCoverage(alias, normalizedText)));
  const requiredCoverage = required.length === 0 ? 0 : required.filter((group) => groupMatches(profile, group, normalizedText)).length / required.length;
  const optionalCoverage = optional.length === 0 ? 0 : optional.filter((group) => groupMatches(profile, group, normalizedText)).length / optional.length;
  const exampleCoverage = maximum(profile.examples.map((example) => exampleOverlap(example, normalizedText)));
  const parameterCoverage = capability.parameters.length === 0 ? 0 : validatedParameterNames.length / capability.parameters.length;
  const score = aliasCoverage * CAPABILITY_SEMANTIC_WEIGHTS.alias
    + requiredCoverage * CAPABILITY_SEMANTIC_WEIGHTS.requiredSignals
    + optionalCoverage * CAPABILITY_SEMANTIC_WEIGHTS.optionalSignals
    + exampleCoverage * CAPABILITY_SEMANTIC_WEIGHTS.example
    + parameterCoverage * CAPABILITY_SEMANTIC_WEIGHTS.parameters;
  return Object.freeze({
    capability: capabilityRef(catalog, capability),
    score,
    validatedParameterNames: Object.freeze(validatedParameterNames)
  });
}

function requiredGroupsMatch(profile: CapabilitySemanticMetadataV1, normalizedText: string): boolean {
  return profile.requiredSignalGroups.every((group) => groupMatches(profile, group, normalizedText));
}

function groupMatches(profile: CapabilitySemanticMetadataV1, group: SemanticSignalGroup, normalizedText: string): boolean {
  const terms = group === 'resource' ? profile.resourceTerms : group === 'intent' ? profile.intentTerms : profile.metricTerms;
  return terms.some((term) => containsPhrase(normalizedText, normalizeCapabilitySemanticText(term)));
}

function phraseCoverage(phrase: string, normalizedText: string): number {
  const normalizedPhrase = normalizeCapabilitySemanticText(phrase);
  if (containsPhrase(normalizedText, normalizedPhrase)) return 1;
  const tokens = uniqueTokens(normalizedPhrase);
  if (tokens.length === 0) return 0;
  const queryTokens = new Set(uniqueTokens(normalizedText));
  return tokens.filter((token) => queryTokens.has(token)).length / tokens.length;
}

function exampleOverlap(example: string, normalizedText: string): number {
  const normalizedExample = normalizeCapabilitySemanticText(example);
  return (jaccard(uniqueTokens(normalizedExample), uniqueTokens(normalizedText))
    + dice(bigrams(normalizedExample), bigrams(normalizedText))) / 2;
}

function jaccard(left: readonly string[], right: readonly string[]): number {
  const a = new Set(left);
  const b = new Set(right);
  const union = new Set([...a, ...b]);
  if (union.size === 0) return 0;
  return [...a].filter((value) => b.has(value)).length / union.size;
}

function dice(left: readonly string[], right: readonly string[]): number {
  const a = new Set(left);
  const b = new Set(right);
  if (a.size + b.size === 0) return 0;
  return 2 * [...a].filter((value) => b.has(value)).length / (a.size + b.size);
}

function bigrams(value: string): string[] {
  const compact = value.replace(/\s+/gu, '');
  return Array.from({ length: Math.max(0, compact.length - 1) }, (_, index) => compact.slice(index, index + 2));
}

function uniqueTokens(value: string): string[] {
  return [...new Set(value.split(' ').filter(Boolean))];
}

function containsPhrase(text: string, phrase: string): boolean {
  return phrase.length > 0 && text.includes(phrase);
}

function maximum(values: readonly number[]): number {
  return values.length === 0 ? 0 : Math.max(...values);
}

function capabilityRef(catalog: ScopedCapabilityCatalogV1, capability: CapabilityDefinitionV1): CapabilityRefV1 {
  return Object.freeze({
    packId: catalog.packId,
    packVersion: catalog.packVersion,
    capabilityKey: capability.capabilityKey,
    safeLabel: capability.safeLabel
  });
}

function notRecognized(): Extract<CapabilityResolutionResultV1, { outcome: 'NEEDS_CLARIFICATION'; reasonCode: 'CAPABILITY_NOT_RECOGNIZED' }> {
  return Object.freeze({
    version: '1' as const,
    outcome: 'NEEDS_CLARIFICATION' as const,
    reasonCode: 'CAPABILITY_NOT_RECOGNIZED' as const,
    missingParameters: Object.freeze([] as const),
    invalidParameters: Object.freeze([] as const),
    conflictingParameters: Object.freeze([] as const)
  });
}

export function normalizeCapabilitySemanticText(value: string): string {
  return value.normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}
