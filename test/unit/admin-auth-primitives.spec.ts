import { validateAdminEnvironment } from '../../src/admin/config/admin-env.validation';
import { ADMIN_SESSION_IDLE_MS } from '../../src/admin/config/admin-settings';
import { checkPasswordRules, hashPassword, verifyAgainstDummy, verifyPassword } from '../../src/admin/auth/password-hasher';
import { generateSecretToken, hashSecretToken, isWellFormedSecretToken } from '../../src/admin/auth/secret-token';
import { isSessionAlive } from '../../src/admin/auth/user-session.service';

/** Feature 014 Phase 2 (T008–T010): admin environment, password hashing, secret tokens, session liveness. */
const baseEnv = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/assistant_test',
  ADMIN_WEB_ORIGIN: 'https://admin.example.test',
  ADMIN_CUSTOMER_ID: 'customer-a',
  ADMIN_MAIL_TRANSPORT: 'log'
};

describe('admin environment', () => {
  it('accepts a local configuration with the log mail transport and applies defaults', () => {
    const env = validateAdminEnvironment({ ...baseEnv });
    expect(env).toMatchObject({ ADMIN_PORT: 3200, ADMIN_COOKIE_SECURE: 'true', ADMIN_MAIL_TRANSPORT: 'log', ADMIN_ENABLE_SWAGGER_DOCS: 'false', ADMIN_TRUSTED_PROXY_HOPS: 0, ADMIN_TIME_ZONE: 'Asia/Taipei', NODE_ENV: 'development' });
  });

  it.each([
    ['missing customer', { ADMIN_CUSTOMER_ID: undefined }, /ADMIN_CUSTOMER_ID/],
    ['missing web origin', { ADMIN_WEB_ORIGIN: undefined }, /ADMIN_WEB_ORIGIN/],
    ['log transport in production', { NODE_ENV: 'production' }, /ADMIN_MAIL_TRANSPORT=log/],
    ['insecure cookie in production', { NODE_ENV: 'production', ADMIN_MAIL_TRANSPORT: 'smtp', ADMIN_SMTP_HOST: 'smtp.example.test',
      ADMIN_SMTP_PORT: '587', ADMIN_MAIL_FROM: 'Admin <no-reply@example.test>', ADMIN_COOKIE_SECURE: 'false' }, /ADMIN_COOKIE_SECURE=false/],
    ['Swagger docs in production', { NODE_ENV: 'production', ADMIN_MAIL_TRANSPORT: 'smtp', ADMIN_SMTP_HOST: 'smtp.example.test',
      ADMIN_SMTP_PORT: '587', ADMIN_MAIL_FROM: 'Admin <no-reply@example.test>', ADMIN_ENABLE_SWAGGER_DOCS: 'true' }, /ADMIN_ENABLE_SWAGGER_DOCS=true/],
    ['an unknown time zone', { ADMIN_TIME_ZONE: 'Mars/Olympus' }, /ADMIN_TIME_ZONE/],
    ['a negative proxy hop count', { ADMIN_TRUSTED_PROXY_HOPS: '-1' }, /ADMIN_TRUSTED_PROXY_HOPS/],
    ['smtp without host, port and sender', { ADMIN_MAIL_TRANSPORT: 'smtp' }, /ADMIN_SMTP_HOST.*ADMIN_SMTP_PORT.*ADMIN_MAIL_FROM/]
  ])('rejects %s', (_label, override, message) => {
    expect(() => validateAdminEnvironment({ ...baseEnv, ...override })).toThrow(message);
  });

  it('accepts a production SMTP configuration', () => {
    expect(validateAdminEnvironment({ ...baseEnv, NODE_ENV: 'production', ADMIN_MAIL_TRANSPORT: 'smtp', ADMIN_SMTP_HOST: 'smtp.example.test',
      ADMIN_SMTP_PORT: '587', ADMIN_MAIL_FROM: 'Admin <no-reply@example.test>' })).toMatchObject({ ADMIN_SMTP_PORT: 587 });
  });
});

describe('admin password hashing', () => {
  it('hashes with a random salt and verifies only the right password', async () => {
    const first = await hashPassword('correct horse battery');
    const second = await hashPassword('correct horse battery');
    expect(first).toMatch(/^scrypt\$32768\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    expect(first).not.toBe(second);
    expect(first).not.toContain('correct horse battery');
    await expect(verifyPassword('correct horse battery', first)).resolves.toBe(true);
    await expect(verifyPassword('wrong horse battery', first)).resolves.toBe(false);
    await expect(verifyPassword('correct horse battery', 'not-a-hash')).resolves.toBe(false);
    await expect(verifyAgainstDummy('anything')).resolves.toBe(false);
  });

  it.each([
    ['short', 'a'.repeat(7), 'ops.admin', 'password_too_short'],
    ['long', 'a'.repeat(129), 'ops.admin', 'password_too_long'],
    ['same as account', 'Ops.Admin.Account', 'ops.admin.account', 'password_same_as_account'],
    ['valid', 'a'.repeat(8), 'ops.admin', null]
  ])('checks password rules: %s', (_label, password, account, expected) => {
    expect(checkPasswordRules(password, account)).toBe(expected);
  });
});

describe('admin secret tokens', () => {
  it('generates distinct URL-safe tokens and stores only a hash', () => {
    const token = generateSecretToken();
    expect(isWellFormedSecretToken(token)).toBe(true);
    expect(generateSecretToken()).not.toBe(token);
    expect(hashSecretToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSecretToken(token)).not.toContain(token);
  });

  it.each([undefined, null, 42, '', 'short', `${'a'.repeat(42)}!`, 'a'.repeat(44)])('rejects malformed token %p', (value) => {
    expect(isWellFormedSecretToken(value)).toBe(false);
  });
});

describe('admin session liveness', () => {
  const now = new Date('2026-11-18T10:00:00.000Z');
  const at = (offsetMs: number) => new Date(now.getTime() + offsetMs);

  it('is alive while not revoked, before the absolute expiry and within the idle limit', () => {
    expect(isSessionAlive({ revokedAt: null, lastSeenAt: at(-ADMIN_SESSION_IDLE_MS + 1000), expiresAt: at(60_000) }, now)).toBe(true);
  });

  it.each([
    ['revoked', { revokedAt: at(-1), lastSeenAt: now, expiresAt: at(60_000) }],
    ['idle for 30 minutes', { revokedAt: null, lastSeenAt: at(-ADMIN_SESSION_IDLE_MS), expiresAt: at(60_000) }],
    ['past the absolute expiry', { revokedAt: null, lastSeenAt: now, expiresAt: now }]
  ])('is not alive when %s', (_label, session) => {
    expect(isSessionAlive(session, now)).toBe(false);
  });
});
