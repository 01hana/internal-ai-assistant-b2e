import { createHash, randomBytes } from 'node:crypto';

/** 32 random bytes, URL-safe. Used for session cookies, CSRF cookies and mail links. */
export function generateSecretToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Only this hash is stored; the token itself never reaches the database or the logs. */
export function hashSecretToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Rejects obviously malformed tokens before any database lookup. */
export function isWellFormedSecretToken(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
}
