import { BadRequestException } from '@nestjs/common';

/** Feature 013 US4: opaque keyset cursor over (lastMessageAt desc, id desc). */
export interface SessionCursor {
  readonly lastMessageAt: Date;
  readonly id: string;
}

export const SESSION_LIST_DEFAULT_LIMIT = 20;
export const SESSION_LIST_MAX_LIMIT = 50;
const MAX_CURSOR_LENGTH = 200;

export function encodeSessionCursor(cursor: SessionCursor): string {
  return Buffer.from(JSON.stringify({ t: cursor.lastMessageAt.toISOString(), id: cursor.id }), 'utf8').toString('base64url');
}

export function decodeSessionCursor(value: string): SessionCursor {
  if (value.length === 0 || value.length > MAX_CURSOR_LENGTH || !/^[A-Za-z0-9_-]+$/.test(value)) throw invalidCursor();
  let parsed: unknown;
  try { parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')); } catch { throw invalidCursor(); }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw invalidCursor();
  const record = parsed as Record<string, unknown>;
  if (Object.keys(record).sort().join(',') !== 'id,t' || typeof record.t !== 'string' || typeof record.id !== 'string' ||
    record.id.length === 0 || record.id.length > 128) throw invalidCursor();
  const lastMessageAt = new Date(record.t);
  if (Number.isNaN(lastMessageAt.getTime()) || lastMessageAt.toISOString() !== record.t) throw invalidCursor();
  return Object.freeze({ lastMessageAt, id: record.id });
}

export function parseSessionListLimit(value: string | undefined): number {
  if (value === undefined) return SESSION_LIST_DEFAULT_LIMIT;
  if (!/^\d{1,3}$/.test(value)) throw new BadRequestException({ error: 'BAD_REQUEST', message: 'Invalid limit.' });
  const limit = Number(value);
  if (limit < 1 || limit > SESSION_LIST_MAX_LIMIT) throw new BadRequestException({ error: 'BAD_REQUEST', message: 'Invalid limit.' });
  return limit;
}

function invalidCursor() {
  return new BadRequestException({ error: 'BAD_REQUEST', message: 'Invalid cursor.' });
}
