import { Injectable } from '@nestjs/common';
import {
  CapabilityFollowUpFrameV1,
  CapabilityFollowUpResolutionDecisionV1,
  CapabilityFrameParameterV1,
  ConversationSemanticFrame,
  FollowUpResolutionDecision,
  SemanticDimension
} from './conversation.types';
import type { ScopedCapabilityCatalogV1 } from '../../capabilities/capability-pack.types';
import { validateCapabilityCanonicalValue } from '../../capabilities/capability-parameter-resolver.service';

const DIMENSIONS = ['resource', 'intent', 'metricOrAspect', 'timeRange', 'entity'] as const;
type DimensionName = (typeof DIMENSIONS)[number];

export interface FollowUpSemanticResolutionInput {
  readonly currentFrame?: ConversationSemanticFrame;
  readonly priorFrames: readonly ConversationSemanticFrame[];
  readonly vagueReference?: boolean;
}

@Injectable()
export class FollowUpSemanticResolverService {
  resolve(input: FollowUpSemanticResolutionInput): FollowUpResolutionDecision {
    if (hasTopicContradiction(input.currentFrame ?? {})) return clarify('CONTRADICTORY_CURRENT_FRAME');
    const current = sanitizeFrame(input.currentFrame);
    const priors = input.priorFrames.map(sanitizeFrame).filter(hasDimensions);

    if (input.vagueReference === true) return clarify('VAGUE_DEIXIS');
    const compatible = priors.filter((prior) => isCompatible(current, prior));
    if (compatible.length > 1) return clarify('MULTIPLE_COMPATIBLE_PRIOR_FRAMES');

    if (compatible.length === 0) {
      if (!hasDimensions(current)) return clarify(priors.length === 0 ? 'NO_PRIOR_SEMANTIC_FRAME' : 'NO_COMPATIBLE_PRIOR_FRAME');
      if (!isCompleteIndependentTopic(current)) return clarify('INCOMPLETE_FOLLOWUP_MEANING');
      return decision('NEW_TOPIC', 'EXPLICIT_INCOMPATIBLE_TOPIC', current, [], []);
    }

    const prior = compatible[compatible.length - 1];
    const incompatibleExplicit = isExplicitlyIncompatible(current, prior);
    if (incompatibleExplicit) {
      if (!isCompleteIndependentTopic(current)) return clarify('INCOMPLETE_NEW_TOPIC');
      return decision('NEW_TOPIC', 'EXPLICIT_INCOMPATIBLE_TOPIC', current, [], []);
    }

    const merged: MutableFrame = {};
    const inherited: string[] = [];
    const replaced: string[] = [];
    for (const name of DIMENSIONS) {
      const explicit = current[name];
      const previous = prior[name];
      if (explicit) {
        merged[name] = copyDimension(name, explicit, 'current_explicit');
        if (previous && !sameDimension(name, explicit, previous)) replaced.push(name);
      } else if (previous) {
        merged[name] = copyDimension(name, previous, 'inherited');
        inherited.push(name);
      }
    }

    const resolved = finalizeFrame(merged);
    if (!hasUsableMeaning(resolved)) return clarify('INCOMPLETE_FOLLOWUP_MEANING');
    return decision(
      replaced.length > 0 ? 'REPLACE' : 'INHERIT',
      replaced.length > 0 ? 'EXPLICIT_DIMENSION_REPLACED' : 'OMITTED_DIMENSIONS_INHERITED',
      resolved,
      inherited,
      replaced
    );
  }

  resolveCapability(input: {
    readonly currentFrame: CapabilityFollowUpFrameV1;
    readonly priorFrames: readonly CapabilityFollowUpFrameV1[];
    readonly catalog: ScopedCapabilityCatalogV1;
  }): CapabilityFollowUpResolutionDecisionV1 {
    const currentCapability = input.catalog.capabilities.find((entry) =>
      entry.active && entry.capabilityKey === input.currentFrame.capabilityKey);
    if (!currentCapability || !frameMatchesCatalog(input.currentFrame, input.catalog)) {
      return capabilityClarify('CURRENT_CAPABILITY_NOT_ACTIVE', []);
    }

    const currentValidation = validateFrameParameters(input.currentFrame, currentCapability.parameters);
    if (currentValidation.invalidated.length > 0) {
      return capabilityClarify('CURRENT_PARAMETER_INVALID', currentValidation.invalidated);
    }
    const compatible = input.priorFrames.filter((frame) => frameMatchesCatalog(frame, input.catalog)
      && frame.capabilityKey === input.currentFrame.capabilityKey);
    if (compatible.length > 1) return capabilityClarify('MULTIPLE_COMPATIBLE_PRIOR_CAPABILITY_FRAMES', []);
    if (compatible.length === 0) {
      if (currentValidation.parameters.length === 0) return capabilityClarify('NO_COMPATIBLE_PRIOR_CAPABILITY_FRAME', []);
      return capabilityDecision('NEW_TOPIC', 'CURRENT_CAPABILITY_FRAME_ONLY', input.currentFrame, [], [], []);
    }

    const priorValidation = validateFrameParameters(compatible[0], currentCapability.parameters);
    if (priorValidation.invalidated.length > 0) {
      return capabilityClarify('INHERITED_PARAMETER_INVALID', priorValidation.invalidated);
    }
    const priorByName = new Map(priorValidation.parameters.map((entry) => [entry.parameterName, entry]));
    const currentByName = new Map(currentValidation.parameters.map((entry) => [entry.parameterName, entry]));
    const inherited: string[] = [];
    const replaced: string[] = [];
    const merged: CapabilityFrameParameterV1[] = [];
    for (const definition of currentCapability.parameters) {
      const current = currentByName.get(definition.parameterName);
      const prior = priorByName.get(definition.parameterName);
      if (current) {
        if (prior && current.value !== prior.value) replaced.push(definition.parameterName);
        merged.push({ ...current, source: 'current_explicit' });
        continue;
      }
      if (!prior) continue;
      inherited.push(definition.parameterName);
      merged.push({ ...prior, source: 'inherited' });
    }
    merged.sort((left, right) => left.parameterName.localeCompare(right.parameterName, 'en-US'));
    const frame = freezeCapabilityFrame({ ...input.currentFrame, parameters: merged });
    return capabilityDecision(
      replaced.length > 0 ? 'REPLACE' : 'INHERIT',
      replaced.length > 0 ? 'EXPLICIT_CAPABILITY_PARAMETER_REPLACED' : 'OMITTED_CAPABILITY_PARAMETERS_INHERITED',
      frame,
      inherited,
      replaced,
      []
    );
  }
}

function frameMatchesCatalog(frame: CapabilityFollowUpFrameV1, catalog: ScopedCapabilityCatalogV1): boolean {
  return frame.scope.customerId === catalog.customerId
    && frame.scope.integrationId === catalog.integrationId
    && frame.scope.hostApp === catalog.hostApp
    && frame.packId === catalog.packId
    && frame.packVersion === catalog.packVersion;
}

function validateFrameParameters(
  frame: CapabilityFollowUpFrameV1,
  definitions: ScopedCapabilityCatalogV1['capabilities'][number]['parameters']
): { parameters: CapabilityFollowUpFrameV1['parameters']; invalidated: string[] } {
  const definitionByName = new Map(definitions.map((entry) => [entry.parameterName, entry]));
  const invalidated: string[] = [];
  const parameters = frame.parameters.flatMap((entry) => {
    const definition = definitionByName.get(entry.parameterName);
    const value = definition ? validateCapabilityCanonicalValue(definition, entry.value) : undefined;
    if (value === undefined) {
      invalidated.push(entry.parameterName);
      return [];
    }
    return [{ ...entry, value }];
  });
  return {
    parameters: Object.freeze(parameters.sort((a, b) => a.parameterName.localeCompare(b.parameterName, 'en-US'))),
    invalidated: [...new Set(invalidated)].sort((a, b) => a.localeCompare(b, 'en-US'))
  };
}

function capabilityDecision(
  kind: CapabilityFollowUpResolutionDecisionV1['kind'],
  reasonCode: string,
  resolvedFrame: CapabilityFollowUpFrameV1,
  inheritedParameters: readonly string[],
  replacedParameters: readonly string[],
  invalidatedParameters: readonly string[]
): CapabilityFollowUpResolutionDecisionV1 {
  return Object.freeze({
    kind, reasonCode, resolvedFrame,
    inheritedParameters: Object.freeze([...inheritedParameters].sort()),
    replacedParameters: Object.freeze([...replacedParameters].sort()),
    invalidatedParameters: Object.freeze([...invalidatedParameters].sort())
  });
}

function capabilityClarify(reasonCode: string, invalidatedParameters: readonly string[]): CapabilityFollowUpResolutionDecisionV1 {
  return Object.freeze({
    kind: 'CLARIFY' as const,
    reasonCode,
    inheritedParameters: Object.freeze([]),
    replacedParameters: Object.freeze([]),
    invalidatedParameters: Object.freeze([...invalidatedParameters].sort())
  });
}

function freezeCapabilityFrame(frame: CapabilityFollowUpFrameV1): CapabilityFollowUpFrameV1 {
  return Object.freeze({
    ...frame,
    scope: Object.freeze({ ...frame.scope }),
    parameters: Object.freeze(frame.parameters.map((entry) => Object.freeze({ ...entry })))
  });
}

type MutableFrame = Partial<Record<DimensionName, SemanticDimension & { entityType?: string }>>;

function sanitizeFrame(value: ConversationSemanticFrame | undefined): ConversationSemanticFrame {
  if (!value) return Object.freeze({});
  const frame: MutableFrame = {};
  for (const name of DIMENSIONS) {
    const candidate = value[name];
    if (!candidate || !safeText(candidate.value) || !safeText(candidate.sourceMessageId)) continue;
    if (name === 'entity') {
      const entity = candidate as ConversationSemanticFrame['entity'];
      if (!entity || !safeText(entity.entityType)) continue;
      frame.entity = copyDimension(name, entity, entity.source === 'inherited' ? 'inherited' : 'current_explicit');
    } else {
      frame[name] = copyDimension(name, candidate, candidate.source === 'inherited' ? 'inherited' : 'current_explicit');
    }
  }
  return finalizeFrame(frame);
}

function finalizeFrame(frame: MutableFrame): ConversationSemanticFrame {
  const resource = frame.resource;
  const entity = frame.entity as ConversationSemanticFrame['entity'];
  const topicKey = [resource?.value, entity?.entityType, entity?.value].filter(Boolean).join(':') || undefined;
  return Object.freeze({
    ...(resource ? { resource } : {}),
    ...(frame.intent ? { intent: frame.intent } : {}),
    ...(frame.metricOrAspect ? { metricOrAspect: frame.metricOrAspect } : {}),
    ...(frame.timeRange ? { timeRange: frame.timeRange } : {}),
    ...(entity ? { entity } : {}),
    ...(topicKey ? { topicKey } : {})
  });
}

function copyDimension(
  name: DimensionName,
  value: SemanticDimension & { readonly entityType?: string },
  source: 'current_explicit' | 'inherited'
): SemanticDimension & { readonly entityType?: string } {
  return Object.freeze({
    value: value.value,
    sourceMessageId: value.sourceMessageId,
    source,
    confidence: finiteConfidence(value.confidence),
    ...(name === 'entity' && value.entityType ? { entityType: value.entityType } : {})
  });
}

function isCompatible(current: ConversationSemanticFrame, prior: ConversationSemanticFrame): boolean {
  if (!hasDimensions(current)) return true;
  if (current.resource && prior.resource && current.resource.value !== prior.resource.value) return false;
  if (current.entity && prior.entity && current.entity.entityType !== prior.entity.entityType) return false;
  return true;
}

function isExplicitlyIncompatible(current: ConversationSemanticFrame, prior: ConversationSemanticFrame): boolean {
  return Boolean(
    (current.resource && prior.resource && current.resource.value !== prior.resource.value) ||
    (current.entity && prior.entity && current.entity.entityType !== prior.entity.entityType)
  );
}

function isCompleteIndependentTopic(frame: ConversationSemanticFrame): boolean {
  return Boolean(frame.resource && (frame.intent || frame.metricOrAspect || frame.entity));
}

function hasUsableMeaning(frame: ConversationSemanticFrame): boolean {
  return Boolean(frame.resource && (frame.intent || frame.metricOrAspect || frame.entity));
}

function hasTopicContradiction(frame: ConversationSemanticFrame): boolean {
  if (!frame.topicKey) return false;
  const expected = [frame.resource?.value, frame.entity?.entityType, frame.entity?.value].filter(Boolean).join(':');
  return expected.length > 0 && frame.topicKey !== expected;
}

function sameDimension(name: DimensionName, left: SemanticDimension & { entityType?: string }, right: SemanticDimension & { entityType?: string }): boolean {
  return left.value === right.value && (name !== 'entity' || left.entityType === right.entityType);
}

function hasDimensions(frame: ConversationSemanticFrame): boolean {
  return DIMENSIONS.some((name) => Boolean(frame[name]));
}

function decision(
  kind: FollowUpResolutionDecision['kind'],
  reasonCode: string,
  resolvedFrame: ConversationSemanticFrame,
  inheritedDimensions: readonly string[],
  replacedDimensions: readonly string[]
): FollowUpResolutionDecision {
  return Object.freeze({
    kind,
    reasonCode,
    resolvedFrame,
    inheritedDimensions: Object.freeze([...inheritedDimensions]),
    replacedDimensions: Object.freeze([...replacedDimensions])
  });
}

function clarify(reasonCode: string): FollowUpResolutionDecision {
  return Object.freeze({
    kind: 'CLARIFY',
    reasonCode,
    resolvedFrame: undefined,
    inheritedDimensions: Object.freeze([]),
    replacedDimensions: Object.freeze([])
  });
}

function safeText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 512;
}

function finiteConfidence(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}
