import { Injectable } from '@nestjs/common';
import {
  ConversationSourceRejectionReason,
  SafeConversationValue
} from './conversation.types';
import {
  MAX_CONTEXT_ARRAY_ITEMS,
  MAX_CONTEXT_METADATA_BYTES,
  MAX_CONTEXT_OBJECT_KEYS,
  MAX_CONTEXT_SOURCE_DEPTH,
  MAX_CONTEXT_STRING_LENGTH
} from './conversation-limits';

export type ConversationSourceGuardResult =
  | Readonly<{ accepted: true; value: SafeConversationValue }>
  | Readonly<{ accepted: false; reasonCode: ConversationSourceRejectionReason }>;

const PROHIBITED_KEY = /^(?:authorization|accessToken|refreshToken|idToken|token|jwt|proof|credential|credentials|password|secret|apiKey|connectorContextRef|connectorRef|connectorKey|adapterKey|deploymentKey|deploymentSelector|opaqueHandle|rawResponse|rawConnectorResponse|rawInput|rawOutput|preProjection|preProjectionData|permissionSnapshot|permissionResult|operationKey|toolKey|toolVersion|toolDefinitionId|canonicalToolKey)$/i;
const PROHIBITED_KEY_FRAGMENT = /(?:credential|password|secret|token|connectorcontext|opaquehandle|rawconnector|preprojection)/i;
const PROHIBITED_VALUE = /^(?:Bearer\s+\S+|Basic\s+\S+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|(?:sk|pk|api|secret|token)_[A-Za-z0-9_-]{8,})$/i;

@Injectable()
export class ConversationSourceGuard {
  guard(value: unknown): ConversationSourceGuardResult {
    const inspected = inspect(value, 0, new WeakSet<object>(), { items: 0 });
    if (!inspected.accepted) return inspected;
    const bytes = byteLength(inspected.value);
    if (bytes === undefined) return { accepted: false, reasonCode: 'CONTEXT_MALFORMED_VALUE' };
    if (bytes > MAX_CONTEXT_METADATA_BYTES) {
      return { accepted: false, reasonCode: 'CONTEXT_METADATA_TOO_LARGE' };
    }
    return inspected;
  }
}

function inspect(
  value: unknown,
  depth: number,
  ancestors: WeakSet<object>,
  state: { items: number }
): ConversationSourceGuardResult {
  if (depth > MAX_CONTEXT_SOURCE_DEPTH) {
    return { accepted: false, reasonCode: 'CONTEXT_DEPTH_EXCEEDED' };
  }
  if (value === null || typeof value === 'boolean') return { accepted: true, value };
  if (typeof value === 'number') {
    return Number.isFinite(value)
      ? { accepted: true, value }
      : { accepted: false, reasonCode: 'CONTEXT_MALFORMED_VALUE' };
  }
  if (typeof value === 'string') {
    if (value.length > MAX_CONTEXT_STRING_LENGTH) {
      return { accepted: false, reasonCode: 'CONTEXT_STRING_TOO_LONG' };
    }
    return PROHIBITED_VALUE.test(value.trim())
      ? { accepted: false, reasonCode: 'PROHIBITED_CONTEXT_SOURCE' }
      : { accepted: true, value };
  }
  if (typeof value !== 'object') {
    return { accepted: false, reasonCode: 'CONTEXT_UNSUPPORTED_VALUE' };
  }
  if (ancestors.has(value)) return { accepted: false, reasonCode: 'CONTEXT_CYCLIC_VALUE' };
  if (Array.isArray(value)) {
    if (value.length > MAX_CONTEXT_ARRAY_ITEMS || state.items + value.length > MAX_CONTEXT_ARRAY_ITEMS) {
      return { accepted: false, reasonCode: 'CONTEXT_ITEM_LIMIT_EXCEEDED' };
    }
    ancestors.add(value);
    state.items += value.length;
    const output: SafeConversationValue[] = [];
    for (const item of value) {
      const inspected = inspect(item, depth + 1, ancestors, state);
      if (!inspected.accepted) {
        ancestors.delete(value);
        return inspected;
      }
      output.push(inspected.value);
    }
    ancestors.delete(value);
    return { accepted: true, value: Object.freeze(output) };
  }
  if (!isPlainObject(value)) {
    return { accepted: false, reasonCode: 'CONTEXT_UNSUPPORTED_VALUE' };
  }

  const keys = Object.keys(value).sort();
  if (keys.length > MAX_CONTEXT_OBJECT_KEYS || state.items + keys.length > MAX_CONTEXT_ARRAY_ITEMS) {
    return {
      accepted: false,
      reasonCode: keys.length > MAX_CONTEXT_OBJECT_KEYS
        ? 'CONTEXT_OBJECT_KEY_LIMIT_EXCEEDED'
        : 'CONTEXT_ITEM_LIMIT_EXCEEDED'
    };
  }
  if (keys.some((key) => PROHIBITED_KEY.test(key) || PROHIBITED_KEY_FRAGMENT.test(key))) {
    return { accepted: false, reasonCode: 'PROHIBITED_CONTEXT_SOURCE' };
  }

  ancestors.add(value);
  state.items += keys.length;
  const output: Record<string, SafeConversationValue> = {};
  for (const key of keys) {
    const inspected = inspect((value as Record<string, unknown>)[key], depth + 1, ancestors, state);
    if (!inspected.accepted) {
      ancestors.delete(value);
      return inspected;
    }
    output[key] = inspected.value;
  }
  ancestors.delete(value);
  return { accepted: true, value: Object.freeze(output) };
}

function byteLength(value: unknown): number | undefined {
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? undefined : Buffer.byteLength(serialized, 'utf8');
  } catch {
    return undefined;
  }
}

function isPlainObject(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
