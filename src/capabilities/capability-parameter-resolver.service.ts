import { Injectable } from '@nestjs/common';
import { MAX_CANDIDATES_MATERIALIZED } from './capability-pack.parser';
import type {
  CanonicalParameterValueV1,
  CapabilityDefinitionV1,
  CapabilityParameterDefinitionV1,
  CapabilityRefV1,
  CapabilityResolutionResultV1
} from './capability-pack.types';

const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

export interface CapabilityParameterResolutionInput {
  readonly capability: CapabilityDefinitionV1;
  readonly capabilityRef: CapabilityRefV1;
  readonly text: string;
  readonly currentValues?: Readonly<Record<string, unknown>>;
  readonly pageContextValues?: Readonly<Record<string, unknown>>;
  readonly inheritedValues?: Readonly<Record<string, unknown>>;
}

export type CapabilityParameterResolutionResult =
  | Readonly<{
      status: 'VALID';
      parameters: Readonly<Record<string, CanonicalParameterValueV1>>;
      validatedParameterNames: readonly string[];
    }>
  | Readonly<{
      status: 'ISSUES';
      result: Extract<CapabilityResolutionResultV1, { outcome: 'NEEDS_CLARIFICATION'; reasonCode: 'PARAMETER_ISSUES' }>;
      validatedParameterNames: readonly string[];
    }>;

@Injectable()
export class CapabilityParameterResolverService {
  resolve(input: CapabilityParameterResolutionInput): CapabilityParameterResolutionResult {
    const parameters: Record<string, CanonicalParameterValueV1> = {};
    const conflicts: Array<{ parameterName: string; candidateCount: number }> = [];
    const invalid: Array<{ parameterName: string; reasonCode: string }> = [];
    const missing: string[] = [];

    for (const definition of [...input.capability.parameters].sort(byParameterName)) {
      const candidates = collectCandidates(definition, input);
      const valid = new Set<CanonicalParameterValueV1>();
      let invalidPresent = candidates.invalidCapture;
      for (const candidate of candidates.values) {
        const normalized = normalizeCandidate(definition, candidate);
        if (normalized === undefined) invalidPresent = true;
        else valid.add(normalized);
      }
      if (valid.size > 1) {
        conflicts.push({ parameterName: definition.parameterName, candidateCount: Math.min(valid.size, MAX_CANDIDATES_MATERIALIZED) });
      } else if (invalidPresent) {
        invalid.push({
          parameterName: definition.parameterName,
          reasonCode: definition.type === 'enum' ? 'VALUE_NOT_DECLARED' : 'VALUE_INVALID'
        });
      } else if (valid.size === 0) {
        if (definition.required) missing.push(definition.parameterName);
      } else {
        parameters[definition.parameterName] = [...valid][0];
      }
    }

    const names = Object.freeze(Object.keys(parameters).sort(compareText));
    if (conflicts.length > 0) return issues(input, names, [], [], conflicts);
    if (invalid.length > 0) return issues(input, names, [], invalid, []);
    if (missing.length > 0) return issues(input, names, missing, [], []);
    return Object.freeze({ status: 'VALID' as const, parameters: Object.freeze(parameters), validatedParameterNames: names });
  }

  validateCanonicalValue(definition: CapabilityParameterDefinitionV1, value: unknown): CanonicalParameterValueV1 | undefined {
    return validateCapabilityCanonicalValue(definition, value);
  }
}

export function validateCapabilityCanonicalValue(
  definition: CapabilityParameterDefinitionV1,
  value: unknown
): CanonicalParameterValueV1 | undefined {
  return normalizeCandidate(definition, value);
}

function collectCandidates(
  definition: CapabilityParameterDefinitionV1,
  input: CapabilityParameterResolutionInput
): { values: unknown[]; invalidCapture: boolean } {
  const values: unknown[] = [];
  for (const source of [input.currentValues, input.pageContextValues, input.inheritedValues]) {
    if (source && Object.prototype.hasOwnProperty.call(source, definition.parameterName)) {
      values.push(source[definition.parameterName]);
    }
  }

  const text = input.text.normalize('NFKC');
  if (definition.type === 'enum') {
    for (const entry of definition.values) {
      for (const alias of entry.aliases) if (normalizeSemantic(text).includes(normalizeSemantic(alias))) values.push(entry.value);
    }
  } else {
    for (const token of identifierTokens(text)) {
      if (definition.prefixes.some((prefix) => token.startsWith(prefix))) values.push(token);
    }
  }

  let invalidCapture = false;
  for (const term of definition.semanticTerms) {
    for (const captured of captureAfterTerm(text, term)) {
      if (definition.type === 'enum') {
        const mapped = normalizeCandidate(definition, captured);
        if (mapped === undefined) invalidCapture = true;
        else values.push(mapped);
      } else {
        values.push(captured);
      }
    }
  }
  return { values: values.slice(0, MAX_CANDIDATES_MATERIALIZED), invalidCapture };
}

function normalizeCandidate(
  definition: CapabilityParameterDefinitionV1,
  candidate: unknown
): CanonicalParameterValueV1 | undefined {
  if (typeof candidate !== 'string') return undefined;
  const value = candidate.normalize('NFKC').trim();
  if (definition.type === 'enum') {
    const semantic = normalizeSemantic(value);
    const match = definition.values.find((entry) => normalizeSemantic(entry.value) === semantic ||
      entry.aliases.some((alias) => normalizeSemantic(alias) === semantic));
    return match?.value;
  }
  if (value.length === 0 || value.length > definition.maxLength || !SAFE_IDENTIFIER.test(value)) return undefined;
  if (definition.prefixes.length > 0 && !definition.prefixes.some((prefix) => value.startsWith(prefix))) return undefined;
  return value;
}

function captureAfterTerm(text: string, term: string): string[] {
  const normalizedText = text.normalize('NFKC');
  const normalizedTerm = term.normalize('NFKC');
  const foldedText = normalizedText.toLocaleLowerCase('en-US');
  const foldedTerm = normalizedTerm.toLocaleLowerCase('en-US');
  const captures: string[] = [];
  let searchFrom = 0;
  while (foldedTerm.length > 0) {
    const index = foldedText.indexOf(foldedTerm, searchFrom);
    if (index < 0) break;
    const remainder = normalizedText.slice(index + normalizedTerm.length).trim().replace(/^[\p{P}\p{S}\s]+/u, '');
    const captured = remainder.match(/^[^\s，。！？、；：,!?;]+/u)?.[0];
    if (captured !== undefined) captures.push(captured);
    searchFrom = index + foldedTerm.length;
  }
  return captures;
}

function identifierTokens(text: string): string[] {
  return text.match(/[A-Za-z0-9][A-Za-z0-9._:-]*/g) ?? [];
}

function normalizeSemantic(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('en-US').replace(/[\p{P}\p{S}\s]+/gu, ' ').trim();
}

function issues(
  input: CapabilityParameterResolutionInput,
  validatedParameterNames: readonly string[],
  missingParameters: readonly string[],
  invalidParameters: readonly { parameterName: string; reasonCode: string }[],
  conflictingParameters: readonly { parameterName: string; candidateCount: number }[]
): CapabilityParameterResolutionResult {
  return Object.freeze({
    status: 'ISSUES' as const,
    validatedParameterNames,
    result: Object.freeze({
      version: '1' as const,
      outcome: 'NEEDS_CLARIFICATION' as const,
      capability: input.capabilityRef,
      reasonCode: 'PARAMETER_ISSUES' as const,
      missingParameters: Object.freeze([...missingParameters].sort(compareText)),
      invalidParameters: Object.freeze([...invalidParameters].sort((a, b) => compareText(a.parameterName, b.parameterName))),
      conflictingParameters: Object.freeze([...conflictingParameters].sort((a, b) => compareText(a.parameterName, b.parameterName)))
    })
  });
}

function byParameterName(left: CapabilityParameterDefinitionV1, right: CapabilityParameterDefinitionV1): number {
  return compareText(left.parameterName, right.parameterName);
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, 'en-US');
}

export function freezeCapabilityResolutionResultV1(input: CapabilityResolutionResultV1): CapabilityResolutionResultV1 {
  if (!isRecord(input) || input.version !== '1' || typeof input.outcome !== 'string') invalidResult();
  const allowed = input.outcome === 'RESOLVED'
    ? ['version', 'outcome', 'capability', 'parameters', 'bindingRef', 'toolCandidate']
    : input.outcome === 'CAPABILITY_UNAVAILABLE'
      ? ['version', 'outcome', 'capability', 'parameters', 'reasonCode']
      : input.outcome === 'AMBIGUOUS'
        ? ['version', 'outcome', 'reasonCode', 'candidates']
        : input.reasonCode === 'CAPABILITY_NOT_RECOGNIZED'
          ? ['version', 'outcome', 'reasonCode', 'missingParameters', 'invalidParameters', 'conflictingParameters']
          : ['version', 'outcome', 'capability', 'reasonCode', 'missingParameters', 'invalidParameters', 'conflictingParameters'];
  if (!exactKeys(input, allowed)) invalidResult();
  if (containsProhibitedKey(input)) invalidResult();
  if (input.outcome === 'AMBIGUOUS' && (!Array.isArray(input.candidates) || input.candidates.length > 5)) invalidResult();
  if (input.outcome === 'NEEDS_CLARIFICATION' && input.reasonCode === 'CAPABILITY_NOT_RECOGNIZED' &&
    (input.missingParameters.length !== 0 || input.invalidParameters.length !== 0 || input.conflictingParameters.length !== 0)) invalidResult();
  return deepFreezeCopy(input);
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === allowed.length && keys.every((key) => allowed.includes(key));
}

function containsProhibitedKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsProhibitedKey);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, entry]) =>
    /(credential|connectorcontext|permission|authorization|token|jwt|rawvalue|prose)/i.test(key) || containsProhibitedKey(entry));
}

function deepFreezeCopy<T>(value: T): T {
  if (Array.isArray(value)) return Object.freeze(value.map(deepFreezeCopy)) as T;
  if (isRecord(value)) return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, deepFreezeCopy(entry)]))) as T;
  return value;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidResult(): never {
  throw new Error('CAPABILITY_RESOLUTION_RESULT_INVALID');
}
