import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';

/**
 * Feature 014: password hashing with Node's built-in scrypt (no native dependency).
 * Stored format: `scrypt$N$r$p$<salt base64>$<hash base64>`, so parameters can be raised later
 * without breaking existing hashes.
 */
const N = 2 ** 15;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
// scrypt needs 128 * N * r bytes; the default 32 MiB limit is too small for N = 2^15.
const MAX_MEMORY = 128 * N * R * 2;

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

function scrypt(password: string, salt: Buffer, keyLength: number, options: { N: number; r: number; p: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keyLength, { ...options, maxmem: MAX_MEMORY }, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const hash = await scrypt(password, salt, KEY_LENGTH, { N, r: R, p: P });
  return ['scrypt', N, R, P, salt.toString('base64'), hash.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, 'base64');
  if (expected.length === 0) return false;
  const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, { N: Number(n), r: Number(r), p: Number(p) });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** A fixed hash checked when the account does not exist, so both paths take about the same time. */
let dummyHash: Promise<string> | undefined;
export async function verifyAgainstDummy(password: string): Promise<false> {
  dummyHash ??= hashPassword(randomBytes(24).toString('base64'));
  await verifyPassword(password, await dummyHash);
  return false;
}

export type PasswordRuleViolation = 'password_too_short' | 'password_too_long' | 'password_same_as_account';

export function checkPasswordRules(password: string, account: string): PasswordRuleViolation | null {
  if (password.length < PASSWORD_MIN_LENGTH) return 'password_too_short';
  if (password.length > PASSWORD_MAX_LENGTH) return 'password_too_long';
  if (password.trim().toLowerCase() === account.trim().toLowerCase()) return 'password_same_as_account';
  return null;
}
