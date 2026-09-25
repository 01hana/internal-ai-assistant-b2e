import type {
  BoundedStringCapabilityParameterV1,
  CapabilityBindingMappingV1,
  CapabilityBindingSemanticConstraintV1,
  CapabilityBindingV1,
  CapabilityDefinitionV1,
  CapabilityParameterDefinitionV1,
  CapabilitySemanticMetadataV1,
  CustomerCapabilityPackV1,
  EnumCapabilityParameterV1,
  EnumCapabilityParameterValueV1,
  SemanticSignalGroup
} from './capability-pack.types';

export const MAX_PACK_BYTES = 262144;
export const MAX_CAPABILITIES_PER_PACK = 128;
export const MAX_BINDINGS_PER_PACK = 256;
export const MAX_SEMANTIC_PROFILES_PER_CAPABILITY = 4;
export const MAX_PARAMETERS_PER_CAPABILITY = 16;
export const MAX_ENUM_VALUES_PER_PARAMETER = 64;
export const MAX_MAPPINGS_PER_BINDING = 32;
export const MAX_TERMS_PER_LIST = 32;
export const MAX_EXAMPLES_PER_PROFILE = 16;
export const MAX_HOST_APPS_PER_PACK = 16;
export const MAX_CANDIDATES_MATERIALIZED = 32;
export const MAX_AMBIGUOUS_CANDIDATE_REFS = 5;
export const MAX_TEXT_LENGTH = 256;
export const MAX_EXAMPLE_LENGTH = 256;
export const MAX_IDENTIFIER_LENGTH = 128;
export const MAX_BOUNDED_STRING_LENGTH = 256;

const PACK_KEYS = keys('version', 'packId', 'packVersion', 'customerId', 'integrationId', 'hostApps', 'active', 'capabilities', 'bindings');
const CAPABILITY_KEYS = keys('version', 'capabilityKey', 'active', 'kind', 'safeLabel', 'semanticProfiles', 'parameters');
const PROFILE_KEYS = keys('version', 'locale', 'aliases', 'examples', 'resourceTerms', 'intentTerms', 'metricTerms', 'requiredSignalGroups');
const ENUM_PARAMETER_KEYS = keys('version', 'parameterName', 'type', 'required', 'semanticTerms', 'values');
const BOUNDED_STRING_PARAMETER_KEYS = keys('version', 'parameterName', 'type', 'required', 'semanticTerms', 'maxLength', 'tokenSyntax', 'prefixes');
const ENUM_VALUE_KEYS = keys('value', 'aliases');
const BINDING_KEYS = keys('version', 'bindingId', 'bindingVersion', 'active', 'capabilityKey', 'semanticConstraints', 'target', 'mappings');
const CONSTRAINT_KEYS = keys('version', 'parameterName', 'operator', 'allowedValues');
const TARGET_KEYS = keys('kind', 'toolKey', 'toolVersion');
const PARAMETER_MAPPING_KEYS = keys('version', 'targetArgument', 'source', 'parameterName');
const CONSTANT_MAPPING_KEYS = keys('version', 'targetArgument', 'source', 'value');
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SEMANTIC_VERSION = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const LOCALE = /^(?:[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*|x(?:-[A-Za-z0-9]{1,8})+)$/;
const PROHIBITED_TEXT = /https?:\/\/|^(?:\/|\.\.?\/|\?)|(?:^|\s)(?:select|insert|update|delete|drop|alter|create|exec(?:ute)?)\s|\b(?:bearer|basic)\s+|(?:^|\s)(?:curl|wget|bash|sh|powershell)\s|\{\{|\}\}|\$\{|<%|%>|javascript:|=>|\bfunction\s*\(|\bcallback\s*\(|\b(?:credential|password|secret|authorization|connectorcontextref|credentialhandle|bindingreference|responsepointer|regex|regexp|expression)\b|ignore\s+(?:all\s+)?previous\s+instructions|\bsystem\s+prompt\b|\bdeveloper\s+message\b/i;

export function parseCustomerCapabilityPackJsonV1(bytes: Uint8Array): CustomerCapabilityPackV1 {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > MAX_PACK_BYTES) invalid();
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    invalid();
  }
  return parseCustomerCapabilityPackV1(parsed);
}

export function parseCustomerCapabilityPackV1(input: unknown): CustomerCapabilityPackV1 {
  if (!isExactObject(input, PACK_KEYS) || input.version !== '1' || typeof input.active !== 'boolean') invalid();
  const parsed: CustomerCapabilityPackV1 = {
    version: '1',
    packId: identifier(input.packId),
    packVersion: semanticVersion(input.packVersion),
    customerId: identifier(input.customerId),
    integrationId: identifier(input.integrationId),
    hostApps: identifierList(input.hostApps, 1, MAX_HOST_APPS_PER_PACK),
    active: input.active,
    capabilities: objectList(input.capabilities, 1, MAX_CAPABILITIES_PER_PACK, parseCapability),
    bindings: objectList(input.bindings, 1, MAX_BINDINGS_PER_PACK, parseBinding)
  };
  assertUnique(parsed.hostApps, (value) => value);
  assertUnique(parsed.capabilities, (value) => value.capabilityKey);
  assertUnique(parsed.bindings, (value) => `${value.bindingId}\u0000${value.bindingVersion}`);
  return parsed;
}

function parseCapability(input: unknown): CapabilityDefinitionV1 {
  if (!isExactObject(input, CAPABILITY_KEYS) || input.version !== '1' || typeof input.active !== 'boolean' || input.kind !== 'READ_ONLY_TOOL') invalid();
  const parsed: CapabilityDefinitionV1 = {
    version: '1',
    capabilityKey: identifier(input.capabilityKey),
    active: input.active,
    kind: 'READ_ONLY_TOOL',
    safeLabel: safeText(input.safeLabel, MAX_TEXT_LENGTH),
    semanticProfiles: objectList(input.semanticProfiles, 1, MAX_SEMANTIC_PROFILES_PER_CAPABILITY, parseSemanticProfile),
    parameters: objectList(input.parameters, 1, MAX_PARAMETERS_PER_CAPABILITY, parseParameter)
  };
  assertUnique(parsed.semanticProfiles, (value) => value.locale.toLocaleLowerCase('en-US'));
  assertUnique(parsed.parameters, (value) => value.parameterName);
  return parsed;
}

function parseSemanticProfile(input: unknown): CapabilitySemanticMetadataV1 {
  if (!isExactObject(input, PROFILE_KEYS) || input.version !== '1') invalid();
  const parsed: CapabilitySemanticMetadataV1 = {
    version: '1',
    locale: locale(input.locale),
    aliases: stringList(input.aliases, 1, MAX_TERMS_PER_LIST, MAX_TEXT_LENGTH),
    examples: stringList(input.examples, 1, MAX_EXAMPLES_PER_PROFILE, MAX_EXAMPLE_LENGTH),
    resourceTerms: stringList(input.resourceTerms, 1, MAX_TERMS_PER_LIST, MAX_TEXT_LENGTH),
    intentTerms: stringList(input.intentTerms, 1, MAX_TERMS_PER_LIST, MAX_TEXT_LENGTH),
    metricTerms: stringList(input.metricTerms, 1, MAX_TERMS_PER_LIST, MAX_TEXT_LENGTH),
    requiredSignalGroups: signalGroupList(input.requiredSignalGroups)
  };
  for (const group of parsed.requiredSignalGroups) {
    const terms = group === 'resource' ? parsed.resourceTerms : group === 'intent' ? parsed.intentTerms : parsed.metricTerms;
    if (terms.length === 0) invalid();
  }
  if (parsed.aliases.length === 0 && parsed.resourceTerms.length === 0) invalid();
  if (parsed.metricTerms.length === 0 && parsed.intentTerms.length === 0) invalid();
  assertUnique(parsed.requiredSignalGroups, (value) => value);
  assertUnique(parsed.examples, normalizeSemanticText);
  assertUnique(
    [...parsed.aliases, ...parsed.resourceTerms, ...parsed.intentTerms, ...parsed.metricTerms],
    normalizeSemanticText
  );
  return parsed;
}

function parseParameter(input: unknown): CapabilityParameterDefinitionV1 {
  if (!isPlainObject(input)) invalid();
  if (input.type === 'enum') return parseEnumParameter(input);
  if (input.type === 'bounded_string') return parseBoundedStringParameter(input);
  invalid();
}

function parseEnumParameter(input: Record<string, unknown>): EnumCapabilityParameterV1 {
  if (!hasExactKeys(input, ENUM_PARAMETER_KEYS) || input.version !== '1' || input.type !== 'enum' || typeof input.required !== 'boolean') invalid();
  const parsed: EnumCapabilityParameterV1 = {
    version: '1',
    parameterName: identifier(input.parameterName),
    type: 'enum',
    required: input.required,
    semanticTerms: stringList(input.semanticTerms, 1, MAX_TERMS_PER_LIST, MAX_TEXT_LENGTH),
    values: objectList(input.values, 1, MAX_ENUM_VALUES_PER_PARAMETER, parseEnumValue)
  };
  assertUnique(parsed.semanticTerms, normalizeSemanticText);
  assertUnique(parsed.values, (value) => value.value);
  const aliasOwners = new Map<string, string>();
  for (const value of parsed.values) {
    for (const alias of value.aliases) {
      const normalized = normalizeSemanticText(alias);
      const owner = aliasOwners.get(normalized);
      if (owner !== undefined && owner !== value.value) invalid();
      aliasOwners.set(normalized, value.value);
    }
  }
  return parsed;
}

function parseEnumValue(input: unknown): EnumCapabilityParameterValueV1 {
  if (!isExactObject(input, ENUM_VALUE_KEYS)) invalid();
  const parsed: EnumCapabilityParameterValueV1 = {
    value: identifier(input.value),
    aliases: stringList(input.aliases, 1, MAX_TERMS_PER_LIST, MAX_TEXT_LENGTH)
  };
  return parsed;
}

function parseBoundedStringParameter(input: Record<string, unknown>): BoundedStringCapabilityParameterV1 {
  if (!hasExactKeys(input, BOUNDED_STRING_PARAMETER_KEYS) || input.version !== '1' || input.type !== 'bounded_string' || typeof input.required !== 'boolean') invalid();
  if (input.tokenSyntax !== 'SAFE_IDENTIFIER') invalid();
  if (!Number.isInteger(input.maxLength) || (input.maxLength as number) < 1 || (input.maxLength as number) > MAX_BOUNDED_STRING_LENGTH) invalid();
  const parsed: BoundedStringCapabilityParameterV1 = {
    version: '1',
    parameterName: identifier(input.parameterName),
    type: 'bounded_string',
    required: input.required,
    semanticTerms: stringList(input.semanticTerms, 1, MAX_TERMS_PER_LIST, MAX_TEXT_LENGTH),
    maxLength: input.maxLength as number,
    tokenSyntax: 'SAFE_IDENTIFIER',
    prefixes: identifierList(input.prefixes, 0, MAX_TERMS_PER_LIST)
  };
  assertUnique(parsed.semanticTerms, normalizeSemanticText);
  assertUnique(parsed.prefixes, (value) => value);
  return parsed;
}

function parseBinding(input: unknown): CapabilityBindingV1 {
  if (!isExactObject(input, BINDING_KEYS) || input.version !== '1' || typeof input.active !== 'boolean') invalid();
  if (!isExactObject(input.target, TARGET_KEYS) || input.target.kind !== 'TOOL') invalid();
  const parsed: CapabilityBindingV1 = {
    version: '1',
    bindingId: identifier(input.bindingId),
    bindingVersion: semanticVersion(input.bindingVersion),
    active: input.active,
    capabilityKey: identifier(input.capabilityKey),
    semanticConstraints: objectList(input.semanticConstraints, 0, MAX_PARAMETERS_PER_CAPABILITY, parseConstraint),
    target: {
      kind: 'TOOL',
      toolKey: identifier(input.target.toolKey),
      toolVersion: semanticVersion(input.target.toolVersion)
    },
    mappings: objectList(input.mappings, 0, MAX_MAPPINGS_PER_BINDING, parseMapping)
  };
  assertUnique(parsed.semanticConstraints, (value) => value.parameterName);
  assertUnique(
    parsed.mappings.filter((value): value is Extract<CapabilityBindingMappingV1, { source: 'CANONICAL_PARAMETER' }> => value.source === 'CANONICAL_PARAMETER'),
    (value) => value.parameterName
  );
  assertUnique(parsed.mappings, (value) => value.targetArgument);
  return parsed;
}

function parseConstraint(input: unknown): CapabilityBindingSemanticConstraintV1 {
  if (!isExactObject(input, CONSTRAINT_KEYS) || input.version !== '1' || input.operator !== 'ENUM_VALUE_IN') invalid();
  const parsed: CapabilityBindingSemanticConstraintV1 = {
    version: '1',
    parameterName: identifier(input.parameterName),
    operator: 'ENUM_VALUE_IN',
    allowedValues: identifierList(input.allowedValues, 1, MAX_ENUM_VALUES_PER_PARAMETER)
  };
  assertUnique(parsed.allowedValues, (value) => value);
  return parsed;
}

function parseMapping(input: unknown): CapabilityBindingMappingV1 {
  if (!isPlainObject(input) || input.version !== '1') invalid();
  if (hasExactKeys(input, PARAMETER_MAPPING_KEYS) && input.source === 'CANONICAL_PARAMETER') {
    return {
      version: '1',
      targetArgument: identifier(input.targetArgument),
      source: 'CANONICAL_PARAMETER',
      parameterName: identifier(input.parameterName)
    };
  }
  if (hasExactKeys(input, CONSTANT_MAPPING_KEYS) && input.source === 'BOUND_CONSTANT') {
    if (!isScalar(input.value)) invalid();
    return {
      version: '1',
      targetArgument: identifier(input.targetArgument),
      source: 'BOUND_CONSTANT',
      value: input.value
    };
  }
  invalid();
}

function objectList<T>(input: unknown, minimum: number, maximum: number, parse: (value: unknown) => T): T[] {
  if (!Array.isArray(input) || input.length < minimum || input.length > maximum) invalid();
  return input.map(parse);
}

function stringList(input: unknown, minimum: number, maximum: number, maxLength: number): string[] {
  if (!Array.isArray(input) || input.length < minimum || input.length > maximum) invalid();
  return input.map((value) => safeText(value, maxLength));
}

function identifierList(input: unknown, minimum: number, maximum: number): string[] {
  if (!Array.isArray(input) || input.length < minimum || input.length > maximum) invalid();
  return input.map(identifier);
}

function signalGroupList(input: unknown): SemanticSignalGroup[] {
  const values = stringList(input, 1, 3, MAX_IDENTIFIER_LENGTH);
  if (values.some((value) => value !== 'resource' && value !== 'intent' && value !== 'metric')) invalid();
  return values as SemanticSignalGroup[];
}

function identifier(input: unknown): string {
  const value = boundedText(input, MAX_IDENTIFIER_LENGTH);
  if (!IDENTIFIER.test(value) || value.includes('*')) invalid();
  return value;
}

function semanticVersion(input: unknown): string {
  const value = boundedText(input, MAX_IDENTIFIER_LENGTH);
  const match = SEMANTIC_VERSION.exec(value);
  if (!match) invalid();
  const prerelease = match[1];
  if (prerelease?.split('.').some((identifierValue) => /^0[0-9]+$/.test(identifierValue))) invalid();
  return value;
}

function locale(input: unknown): string {
  const value = boundedText(input, MAX_IDENTIFIER_LENGTH);
  if (!LOCALE.test(value)) invalid();
  return value;
}

function boundedText(input: unknown, maximum: number): string {
  if (typeof input !== 'string' || input.length < 1 || input.length > maximum) invalid();
  return input;
}

function safeText(input: unknown, maximum: number): string {
  const value = boundedText(input, maximum);
  if (PROHIBITED_TEXT.test(value)) invalid();
  return value;
}

function normalizeSemanticText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('en-US').replace(/\s+/gu, ' ').trim();
}

function assertUnique<T>(values: readonly T[], keyOf: (value: T) => string): void {
  const seen = new Set<string>();
  for (const value of values) {
    const key = keyOf(value);
    if (seen.has(key)) invalid();
    seen.add(key);
  }
}

function isScalar(input: unknown): input is string | number | boolean {
  return typeof input === 'string' && input.length >= 1 && input.length <= MAX_TEXT_LENGTH && !PROHIBITED_TEXT.test(input) ||
    typeof input === 'number' && Number.isFinite(input) ||
    typeof input === 'boolean';
}

function keys(...values: string[]): ReadonlySet<string> {
  return new Set(values);
}

function isExactObject(input: unknown, allowed: ReadonlySet<string>): input is Record<string, unknown> {
  return isPlainObject(input) && hasExactKeys(input, allowed);
}

function hasExactKeys(input: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  const actual = Object.keys(input);
  return actual.length === allowed.size && actual.every((key) => allowed.has(key));
}

function isPlainObject(input: unknown): input is Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return false;
  const prototype = Object.getPrototypeOf(input);
  return prototype === Object.prototype || prototype === null;
}

function invalid(): never {
  throw new Error('CAPABILITY_PACK_INVALID');
}
