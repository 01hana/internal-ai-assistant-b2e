export const MAX_COMPACT_JWT_BYTES = 16 * 1024;
export const MAX_PROTECTED_HEADER_BYTES = 2 * 1024;
export const MAX_ROUTING_PAYLOAD_BYTES = 4 * 1024;

export type UnverifiedRoutingMetadata = Readonly<{
  issuerHint: string;
  kidHint?: string;
}>;

/** Bounded, non-authoritative compact-token metadata parser. */
export class RoutingMetadataParser {
  parse(compactJwt: string): UnverifiedRoutingMetadata {
    if (typeof compactJwt !== 'string' || Buffer.byteLength(compactJwt, 'utf8') > MAX_COMPACT_JWT_BYTES) throw new MalformedRoutingMetadataError();
    const segments = compactJwt.split('.');
    if (segments.length !== 3 || segments.some((segment) => !segment || !base64url(segment))) throw new MalformedRoutingMetadataError();

    const header = object(parseSegment(segments[0], MAX_PROTECTED_HEADER_BYTES));
    const payload = object(parseSegment(segments[1], MAX_ROUTING_PAYLOAD_BYTES));
    const issuerHint = requiredHint(payload.iss);
    const kidHint = optionalHint(header.kid);
    return Object.freeze(kidHint === undefined ? { issuerHint } : { issuerHint, kidHint });
  }
}

function parseSegment(segment: string, maximumBytes: number): unknown {
  try {
    if (segment.length % 4 === 1) throw new Error();
    const bytes = Buffer.from(segment, 'base64url');
    if (bytes.length > maximumBytes || bytes.toString('base64url') !== segment) throw new Error();
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new MalformedRoutingMetadataError();
  }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new MalformedRoutingMetadataError();
  return value as Record<string, unknown>;
}

function requiredHint(value: unknown): string {
  const normalized = optionalHint(value);
  if (normalized === undefined) throw new MalformedRoutingMetadataError();
  return normalized;
}

function optionalHint(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized && !controlCharacter(normalized) ? normalized : undefined;
}

function base64url(value: string): boolean { return /^[A-Za-z0-9_-]+$/.test(value); }
function controlCharacter(value: string): boolean { return [...value].some((character) => { const code = character.codePointAt(0) ?? 0; return code <= 31 || code === 127; }); }

export class MalformedRoutingMetadataError extends Error {
  constructor() {
    super('Malformed routing metadata.');
    this.name = 'MalformedRoutingMetadataError';
  }
}
