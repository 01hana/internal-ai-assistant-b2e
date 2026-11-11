import { lstatSync, readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { createCompanyScopePolicy, type CompanyScopeVocabularyV1 } from './company-scope.policy';
import type { QueryScopeActivation, QueryScopeRegistration } from './query-scope.types';

/**
 * Customer-owned Query Scope policy configuration, version 1.
 *
 * A file names the vocabulary of one Customer and the exact Capability → Binding → Tool
 * activations it guards. It never grants Tool, permission, or company authority; it can
 * only narrow an already authorized request to ALLOW / CLARIFY / DENY.
 */
export interface QueryScopePolicyConfigV1 {
  readonly version: '1';
  readonly policyId: string;
  readonly kind: 'CURRENT_COMPANY_ONLY';
  readonly locale: 'zh-TW';
  readonly description?: string;
  readonly vocabulary: CompanyScopeVocabularyV1;
  readonly applyTo: readonly QueryScopeActivation[];
}

export const QUERY_SCOPE_POLICY_PATHS_ENV = 'ASSISTANT_QUERY_SCOPE_POLICY_PATHS_JSON';
export const MAX_QUERY_SCOPE_POLICY_BYTES = 64 * 1024;

const VOCABULARY_KEYS: readonly (keyof CompanyScopeVocabularyV1)[] = Object.freeze([
  'currentCompanyPrefixes', 'currentCompanyNouns', 'companyNouns', 'otherCompanyQualifiers',
  'vagueCompanyQualifiers', 'companySignals', 'unverifiedScopeTerms', 'queryVerbs', 'negationTerms',
  'negationVerbs', 'exclusionSuffixes', 'clauseSwitchTerms', 'timeModifiers',
  'scopeAnchorTerms'
]);
const ACTIVATION_KEYS: readonly (keyof QueryScopeActivation)[] = Object.freeze([
  'customerId', 'integrationId', 'hostApp', 'capabilityKey', 'bindingId', 'toolKey', 'toolVersion'
]);
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const POLICY_ID = /^[a-z0-9][a-z0-9.-]{0,63}$/;
const MAX_TERMS = 64;
const MAX_TERM_LENGTH = 32;
const MAX_ACTIVATIONS = 64;

/** Parses one configuration object; any deviation from the closed V1 schema fails closed. */
export function parseQueryScopePolicyConfigV1(value: unknown): QueryScopePolicyConfigV1 {
  const root = closedObject(value, ['version', 'policyId', 'kind', 'locale', 'vocabulary', 'applyTo'], ['description']);
  if (root.version !== '1' || root.kind !== 'CURRENT_COMPANY_ONLY' || root.locale !== 'zh-TW') invalid();
  if (typeof root.policyId !== 'string' || !POLICY_ID.test(root.policyId)) invalid();
  if (root.description !== undefined && (typeof root.description !== 'string' || root.description.length > 500)) invalid();
  const vocabularyInput = closedObject(root.vocabulary, VOCABULARY_KEYS, []);
  const vocabulary = Object.freeze(Object.fromEntries(VOCABULARY_KEYS.map((key) =>
    [key, terms(vocabularyInput[key])]))) as unknown as CompanyScopeVocabularyV1;
  if (!Array.isArray(root.applyTo) || root.applyTo.length < 1 || root.applyTo.length > MAX_ACTIVATIONS) invalid();
  const seen = new Set<string>();
  const applyTo = Object.freeze(root.applyTo.map((entry) => {
    const activation = closedObject(entry, ACTIVATION_KEYS, []);
    for (const key of ACTIVATION_KEYS) {
      if (typeof activation[key] !== 'string' || !IDENTIFIER.test(activation[key] as string)) invalid();
    }
    const identity = activationIdentity(activation as unknown as QueryScopeActivation);
    if (seen.has(identity)) invalid();
    seen.add(identity);
    return Object.freeze(Object.fromEntries(ACTIVATION_KEYS.map((key) => [key, activation[key]]))) as unknown as QueryScopeActivation;
  }));
  // Compile once here so an unusable vocabulary fails at load time, not on the first request.
  createCompanyScopePolicy(vocabulary);
  return Object.freeze({
    version: '1', policyId: root.policyId, kind: 'CURRENT_COMPANY_ONLY', locale: 'zh-TW',
    ...(root.description !== undefined ? { description: root.description as string } : {}),
    vocabulary, applyTo
  });
}

export function parseQueryScopePolicyConfigJsonV1(bytes: Uint8Array | string): QueryScopePolicyConfigV1 {
  const text = typeof bytes === 'string' ? bytes : new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (Buffer.byteLength(text, 'utf8') > MAX_QUERY_SCOPE_POLICY_BYTES) invalid();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    invalid();
  }
  return parseQueryScopePolicyConfigV1(parsed);
}

/** Exact registrations for one parsed configuration; every activation shares one compiled policy. */
export function createQueryScopeRegistrations(config: QueryScopePolicyConfigV1): readonly QueryScopeRegistration[] {
  const policy = createCompanyScopePolicy(config.vocabulary);
  return Object.freeze(config.applyTo.map((activation) => Object.freeze({ ...activation, policy })));
}

/**
 * Loads the configured policy files. An unset or empty list installs no Customer policy.
 * Any invalid path, file, schema, or duplicate activation across files throws and stops startup.
 */
export function loadQueryScopeRegistrationsFromEnv(env: NodeJS.ProcessEnv): readonly QueryScopeRegistration[] {
  try {
    const paths = parseConfiguredPaths(env[QUERY_SCOPE_POLICY_PATHS_ENV] ?? '[]');
    const registrations: QueryScopeRegistration[] = [];
    const seen = new Set<string>();
    for (const path of paths) {
      const stat = lstatSync(path);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > MAX_QUERY_SCOPE_POLICY_BYTES) invalid();
      for (const registration of createQueryScopeRegistrations(parseQueryScopePolicyConfigJsonV1(readFileSync(path)))) {
        const identity = activationIdentity(registration);
        if (seen.has(identity)) invalid();
        seen.add(identity);
        registrations.push(registration);
      }
    }
    return Object.freeze(registrations);
  } catch {
    invalid();
  }
}

function parseConfiguredPaths(input: string): readonly string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    invalid();
  }
  if (!Array.isArray(parsed) || parsed.some((path) => typeof path !== 'string' || !isAbsolute(path))) invalid();
  if (new Set(parsed).size !== parsed.length) invalid();
  return parsed as string[];
}

function terms(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_TERMS) invalid();
  const output = value.map((term) => {
    if (typeof term !== 'string') invalid();
    const normalized = term.normalize('NFKC');
    // Queries are NFKC-normalized and lowercased before matching, so terms must already be.
    if (normalized !== term || term.toLocaleLowerCase('en-US') !== term || term.trim() !== term || term.length < 1 || term.length > MAX_TERM_LENGTH ||
      /[\p{Cc}\p{Cf}\s]/u.test(term)) invalid();
    return term;
  });
  if (new Set(output).size !== output.length) invalid();
  return Object.freeze(output);
}

function closedObject(value: unknown, required: readonly string[], optional: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) invalid();
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (required.some((key) => !Object.prototype.hasOwnProperty.call(record, key)) ||
    keys.some((key) => !required.includes(key) && !optional.includes(key))) invalid();
  return record;
}

function activationIdentity(activation: QueryScopeActivation): string {
  return ACTIVATION_KEYS.map((key) => activation[key]).join('\u0000');
}

function invalid(): never {
  throw new Error('QUERY_SCOPE_POLICY_CONFIG_INVALID');
}
