import { Injectable } from '@nestjs/common';

const MAX_TITLE_LENGTH = 256;
const MAX_CONTENT_LENGTH = 4000;
const MAX_METADATA_DEPTH = 4;
const MAX_METADATA_KEYS = 32;
const MAX_METADATA_ARRAY_ITEMS = 100;
const MAX_METADATA_BYTES = 16 * 1024;
const SECRET_VALUE = /\b(?:authorization\s*:\s*)?(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]{6,}|\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b|\b(?:sk|api)[_-][A-Za-z0-9_-]{12,}\b/i;
const PROHIBITED_KEY = /(?:credential|password|secret|token|jwt|proof|authorization|permission(?:result|snapshot)?|operation(?:key|id)?|tool(?:definition|call)?(?:id|key)?|canonicaltoolkey|connector(?:key|ref|context)?|adapter(?:key)?|deployment|endpoint|raw(?:response|output|data)?|preprojection|selector|opaquehandle|instructions?|authority)/i;
const ALLOWED_METADATA_KEYS = new Set([
  'documentId', 'chunkId', 'documentVersion', 'sourceKey', 'heading', 'matchedTermCount', 'score', 'rank'
]);

export type DocumentEvidenceSourceRejectionReason =
  | 'DOCUMENT_EVIDENCE_SOURCE_MALFORMED'
  | 'DOCUMENT_EVIDENCE_SOURCE_TOO_LARGE'
  | 'DOCUMENT_EVIDENCE_SOURCE_CONTROL_CHARACTER'
  | 'DOCUMENT_EVIDENCE_SOURCE_SECRET'
  | 'DOCUMENT_EVIDENCE_SOURCE_PROHIBITED_KEY';

export type DocumentEvidenceSourceGuardResult =
  | Readonly<{ accepted: true }>
  | Readonly<{ accepted: false; reasonCode: DocumentEvidenceSourceRejectionReason }>;

@Injectable()
export class DocumentEvidenceSourceGuard {
  inspect(input: Readonly<{ title: unknown; content: unknown; metadata?: unknown }>): DocumentEvidenceSourceGuardResult {
    if (typeof input.title !== 'string' || typeof input.content !== 'string' || input.title.trim().length === 0 || input.content.trim().length === 0) {
      return rejected('DOCUMENT_EVIDENCE_SOURCE_MALFORMED');
    }
    if (input.title.length > MAX_TITLE_LENGTH || input.content.length > MAX_CONTENT_LENGTH) {
      return rejected('DOCUMENT_EVIDENCE_SOURCE_TOO_LARGE');
    }
    if (containsControlCharacter(input.title) || containsControlCharacter(input.content)) {
      return rejected('DOCUMENT_EVIDENCE_SOURCE_CONTROL_CHARACTER');
    }
    if (SECRET_VALUE.test(input.title) || SECRET_VALUE.test(input.content)) {
      return rejected('DOCUMENT_EVIDENCE_SOURCE_SECRET');
    }
    if (input.metadata === undefined) return Object.freeze({ accepted: true });

    const seen = new Set<object>();
    const counter = { keys: 0, items: 0 };
    if (!isPlainObject(input.metadata)) return rejected('DOCUMENT_EVIDENCE_SOURCE_MALFORMED');
    for (const key of Object.keys(input.metadata)) {
      if (!ALLOWED_METADATA_KEYS.has(key)) return rejected('DOCUMENT_EVIDENCE_SOURCE_PROHIBITED_KEY');
    }
    const validation = validateValue(input.metadata, 1, seen, counter);
    if (validation) return rejected(validation);
    try {
      if (Buffer.byteLength(JSON.stringify(input.metadata), 'utf8') > MAX_METADATA_BYTES) {
        return rejected('DOCUMENT_EVIDENCE_SOURCE_TOO_LARGE');
      }
    } catch {
      return rejected('DOCUMENT_EVIDENCE_SOURCE_MALFORMED');
    }
    return Object.freeze({ accepted: true });
  }
}

function validateValue(
  value: unknown,
  depth: number,
  seen: Set<object>,
  counter: { keys: number; items: number }
): DocumentEvidenceSourceRejectionReason | undefined {
  if (depth > MAX_METADATA_DEPTH) return 'DOCUMENT_EVIDENCE_SOURCE_TOO_LARGE';
  if (value === null || typeof value === 'boolean') return undefined;
  if (typeof value === 'number') return Number.isFinite(value) ? undefined : 'DOCUMENT_EVIDENCE_SOURCE_MALFORMED';
  if (typeof value === 'string') {
    if (value.length > MAX_CONTENT_LENGTH) return 'DOCUMENT_EVIDENCE_SOURCE_TOO_LARGE';
    if (containsControlCharacter(value)) return 'DOCUMENT_EVIDENCE_SOURCE_CONTROL_CHARACTER';
    if (SECRET_VALUE.test(value)) return 'DOCUMENT_EVIDENCE_SOURCE_SECRET';
    return undefined;
  }
  if (typeof value !== 'object') return 'DOCUMENT_EVIDENCE_SOURCE_MALFORMED';
  if (seen.has(value)) return 'DOCUMENT_EVIDENCE_SOURCE_MALFORMED';
  seen.add(value);
  if (Array.isArray(value)) {
    counter.items += value.length;
    if (counter.items > MAX_METADATA_ARRAY_ITEMS) return 'DOCUMENT_EVIDENCE_SOURCE_TOO_LARGE';
    for (const item of value) {
      const reason = validateValue(item, depth + 1, seen, counter);
      if (reason) return reason;
    }
    seen.delete(value);
    return undefined;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return 'DOCUMENT_EVIDENCE_SOURCE_MALFORMED';
  for (const key of Object.keys(value).sort()) {
    counter.keys += 1;
    if (counter.keys > MAX_METADATA_KEYS) return 'DOCUMENT_EVIDENCE_SOURCE_TOO_LARGE';
    if (PROHIBITED_KEY.test(key)) return 'DOCUMENT_EVIDENCE_SOURCE_PROHIBITED_KEY';
    const reason = validateValue((value as Record<string, unknown>)[key], depth + 1, seen, counter);
    if (reason) return reason;
  }
  seen.delete(value);
  return undefined;
}

function rejected(reasonCode: DocumentEvidenceSourceRejectionReason): DocumentEvidenceSourceGuardResult {
  return Object.freeze({ accepted: false, reasonCode });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code === 127 || (code < 32 && code !== 9 && code !== 10 && code !== 13);
  });
}
