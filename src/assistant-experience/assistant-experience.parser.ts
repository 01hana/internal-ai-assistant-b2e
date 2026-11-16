import {
  AssistantExperiencePayloadV1,
  EXPERIENCE_LIMITS as L,
  ExperienceConfigError,
  ExperienceParseResult
} from './assistant-experience.types';

type Obj = Record<string, unknown>;

/** Closed-shape structural validation. Cross-checks against the Capability Pack live in the validator. */
export function parseAssistantExperiencePayload(input: unknown): ExperienceParseResult {
  const errors: ExperienceConfigError[] = [];
  const err = (path: string, code: string) => errors.push({ path, code });
  if (!isObj(input)) return { ok: false, errors: [{ path: '$', code: 'NOT_OBJECT' }] };

  closed(input, '$', ['version', 'configVersion', 'customerId', 'integrationId', 'hostApps', 'locale',
    'semanticReviewStatus', 'greeting', 'maxQuickReplies', 'quickReplies', 'followUps'], [], err);
  if (required(input, '$', 'version', err) && input.version !== '1') err('$.version', 'UNSUPPORTED_VERSION');
  pattern(input, '$', 'configVersion', L.versionPattern, err);
  text(input, '$', 'customerId', L.scopeValueMaxLength, err);
  text(input, '$', 'integrationId', L.scopeValueMaxLength, err);
  text(input, '$', 'locale', 16, err);
  oneOf(input, '$', 'semanticReviewStatus', ['NEEDS_HUMAN_REVIEW', 'HUMAN_VERIFIED'], err);
  stringArray(input, '$', 'hostApps', 1, 20, L.scopeValueMaxLength, err);
  integer(input, '$', 'maxQuickReplies', L.maxQuickRepliesRange[0], L.maxQuickRepliesRange[1], err);

  if (required(input, '$', 'greeting', err)) {
    if (!isObj(input.greeting)) err('$.greeting', 'INVALID_TYPE');
    else {
      closed(input.greeting, '$.greeting', ['text'], [], err);
      text(input.greeting, '$.greeting', 'text', L.greetingMaxLength, err);
    }
  }

  const ids = new Set<string>();
  const uniqueId = (item: Obj, path: string) => {
    if (typeof item.id !== 'string') return;
    if (!L.idPattern.test(item.id)) err(`${path}.id`, 'INVALID_ID');
    else if (ids.has(item.id)) err(`${path}.id`, 'DUPLICATE_ID');
    else ids.add(item.id);
  };

  list(input, '$', 'quickReplies', L.quickRepliesMax, err, (item, path) => {
    const kind = item.kind;
    closed(item, path, ['id', 'kind', 'label', 'message', 'priority'], ['capabilityKey', 'parameters', 'pageScope'], err);
    text(item, path, 'id', 64, err);
    uniqueId(item, path);
    oneOf(item, path, 'kind', ['capability', 'capability_overview'], err);
    text(item, path, 'label', L.labelMaxLength, err);
    text(item, path, 'message', L.messageMaxLength, err);
    integer(item, path, 'priority', L.priorityRange[0], L.priorityRange[1], err);
    if (kind === 'capability') {
      text(item, path, 'capabilityKey', 128, err);
      optionalParameters(item, path, 'parameters', err);
    } else if (kind === 'capability_overview') {
      for (const key of ['capabilityKey', 'parameters']) if (key in item) err(`${path}.${key}`, 'NOT_ALLOWED_FOR_KIND');
    }
    if ('pageScope' in item) {
      if (!isObj(item.pageScope)) err(`${path}.pageScope`, 'INVALID_TYPE');
      else {
        closed(item.pageScope, `${path}.pageScope`, ['modules'], [], err);
        stringArray(item.pageScope, `${path}.pageScope`, 'modules', 1, L.pageModulesMax, L.moduleMaxLength, err);
      }
    }
  });

  list(input, '$', 'followUps', L.followUpsMax, err, (item, path) => {
    closed(item, path, ['id', 'whenCapabilityKey', 'label', 'message', 'capabilityKey'], ['whenParameters', 'parameters'], err);
    text(item, path, 'id', 64, err);
    uniqueId(item, path);
    text(item, path, 'whenCapabilityKey', 128, err);
    text(item, path, 'label', L.labelMaxLength, err);
    text(item, path, 'message', L.messageMaxLength, err);
    text(item, path, 'capabilityKey', 128, err);
    optionalParameters(item, path, 'whenParameters', err);
    optionalParameters(item, path, 'parameters', err);
  });

  return errors.length > 0
    ? { ok: false, errors: Object.freeze(errors) }
    : { ok: true, payload: deepFreeze(structuredClone(input)) as unknown as AssistantExperiencePayloadV1 };
}

type Report = (path: string, code: string) => void;

function isObj(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Reports keys outside the closed shape. Presence of each allowed key is checked by its own field rule. */
function closed(value: Obj, path: string, allowedKeys: readonly string[], optionalKeys: readonly string[], err: Report) {
  for (const key of Object.keys(value)) if (!allowedKeys.includes(key) && !optionalKeys.includes(key)) err(`${path}.${key}`, 'UNKNOWN_KEY');
}

function required(value: Obj, path: string, key: string, err: Report): boolean {
  if (value[key] !== undefined) return true;
  err(`${path}.${key}`, 'REQUIRED');
  return false;
}

function text(value: Obj, path: string, key: string, max: number, err: Report) {
  if (!required(value, path, key, err)) return;
  const item = value[key];
  if (typeof item !== 'string') err(`${path}.${key}`, 'INVALID_TYPE');
  else if (item.trim().length === 0) err(`${path}.${key}`, 'EMPTY');
  else if ([...item].length > max) err(`${path}.${key}`, 'TOO_LONG');
}

function pattern(value: Obj, path: string, key: string, regex: RegExp, err: Report) {
  if (!required(value, path, key, err)) return;
  if (typeof value[key] !== 'string' || !regex.test(value[key] as string)) err(`${path}.${key}`, 'INVALID_FORMAT');
}

function oneOf(value: Obj, path: string, key: string, allowed: readonly string[], err: Report) {
  if (!required(value, path, key, err)) return;
  if (!allowed.includes(value[key] as string)) err(`${path}.${key}`, 'INVALID_VALUE');
}

function integer(value: Obj, path: string, key: string, min: number, max: number, err: Report) {
  if (!required(value, path, key, err)) return;
  const item = value[key];
  if (typeof item !== 'number' || !Number.isInteger(item) || item < min || item > max) err(`${path}.${key}`, 'OUT_OF_RANGE');
}

function stringArray(value: Obj, path: string, key: string, minItems: number, maxItems: number, maxLength: number, err: Report) {
  if (!required(value, path, key, err)) return;
  const items = value[key];
  if (!Array.isArray(items)) return err(`${path}.${key}`, 'INVALID_TYPE');
  if (items.length < minItems || items.length > maxItems) err(`${path}.${key}`, 'OUT_OF_RANGE');
  items.forEach((item, index) => {
    if (typeof item !== 'string' || item.trim().length === 0 || item.length > maxLength) err(`${path}.${key}[${index}]`, 'INVALID_VALUE');
  });
  if (new Set(items).size !== items.length) err(`${path}.${key}`, 'DUPLICATE_VALUE');
}

function list(value: Obj, path: string, key: string, max: number, err: Report, each: (item: Obj, path: string) => void) {
  if (!required(value, path, key, err)) return;
  const items = value[key];
  if (!Array.isArray(items)) return err(`${path}.${key}`, 'INVALID_TYPE');
  if (items.length > max) err(`${path}.${key}`, 'OUT_OF_RANGE');
  items.forEach((item, index) => {
    const itemPath = `${path}.${key}[${index}]`;
    if (!isObj(item)) err(itemPath, 'INVALID_TYPE');
    else each(item, itemPath);
  });
}

function optionalParameters(value: Obj, path: string, key: string, err: Report) {
  if (!(key in value)) return;
  const params = value[key];
  if (!isObj(params)) return err(`${path}.${key}`, 'INVALID_TYPE');
  const entries = Object.entries(params);
  if (entries.length === 0 || entries.length > L.parametersMax) err(`${path}.${key}`, 'OUT_OF_RANGE');
  for (const [name, item] of entries) {
    const ok = (typeof item === 'string' && item.length > 0 && item.length <= L.parameterStringMaxLength) ||
      typeof item === 'boolean' || (typeof item === 'number' && Number.isFinite(item));
    if (!ok) err(`${path}.${key}.${name}`, 'INVALID_TYPE');
  }
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const item of Object.values(value)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
}
