import { UserTokenPurpose } from '../../src/generated/prisma/client';
import { UserTokenService } from '../../src/admin/auth/user-token.service';
import { runAdminBootstrap } from '../../src/admin/bootstrap/admin-bootstrap.cli';
import {
  ADMIN_TEST_ORIGIN, api, type AdminTestContext, closeAdminTestApp, configureAdminTestEnvironment, cookiesOf, createAdminTestApp, describeDbBackedAdmin, flush,
  fromSite, INTERNAL_USER_FIELDS, resetAdminTables, seedUser, signIn
} from '../support/admin-test-app.helper';

/** Feature 014 US1, US2, US5 (T012–T015) against the test database. */
const PASSWORD = 'correct horse battery';
const NEW_PASSWORD = 'a brand new passphrase';
const MINUTE = 60_000;

// Real scrypt hashing on every login attempt; allow more than the default 5 seconds.
jest.setTimeout(60_000);

describeDbBackedAdmin('admin auth (Feature 014)', () => {
  let ctx: AdminTestContext;
  const base = '/api/v1/admin/auth';

  beforeEach(async () => {
    ctx = await createAdminTestApp();
    await resetAdminTables(ctx.db);
  });
  afterEach(async () => { await closeAdminTestApp(ctx); });

  const issue = (userId: string, purpose: UserTokenPurpose) => ctx.app.get(UserTokenService).issue(userId, purpose);
  const auditTypes = async () => (await ctx.db.userAuditEvent.findMany({ orderBy: { timestamp: 'asc' } })).map((event) => event.eventType);

  it('answers the health check without a session', async () => {
    const { body } = await api(ctx.app).get('/api/v1/admin/health').expect(200);
    expect(body.data).toEqual({ status: 'healthy' });
  });

  describe('first login link (US2-1, US2-2)', () => {
    it('shows the account, sets the password once, then allows login', async () => {
      const user = await seedUser(ctx.db, { account: 'ops.admin', password: null, groups: ['admin'] });
      const { token } = await issue(user.id, UserTokenPurpose.first_login);

      const verified = await fromSite(api(ctx.app).post(`${base}/verifyToken`)).send({ token });
      expect(verified.status).toBe(200);
      expect(verified.body.data).toEqual({ account: 'ops.admin', purpose: 'first_login' });

      expect((await fromSite(api(ctx.app).post(`${base}/firstLogin`)).send({ token, password: PASSWORD })).status).toBe(200);
      const reused = await fromSite(api(ctx.app).post(`${base}/firstLogin`)).send({ token, password: NEW_PASSWORD });
      expect(reused.status).toBe(400);
      expect(reused.body.error.code).toBe('INVALID_OR_EXPIRED_LINK');

      await signIn(ctx.app, 'ops.admin', PASSWORD);
      expect(await auditTypes()).toEqual(['admin_password_set', 'admin_login_succeeded']);
    });

    it('rejects an expired link, a link of the other purpose and a weak password', async () => {
      const user = await seedUser(ctx.db, { account: 'ops.admin', password: null });
      const { token } = await issue(user.id, UserTokenPurpose.first_login);

      const weak = await fromSite(api(ctx.app).post(`${base}/firstLogin`)).send({ token, password: 'short' });
      expect(weak.body.error.code).toBe('PASSWORD_TOO_SHORT');
      expect((await fromSite(api(ctx.app).post(`${base}/reset`)).send({ token, password: PASSWORD })).status).toBe(400);

      ctx.clock.advance(72 * 60 * MINUTE + 1000);
      expect((await fromSite(api(ctx.app).post(`${base}/verifyToken`)).send({ token })).status).toBe(400);
      expect((await fromSite(api(ctx.app).post(`${base}/firstLogin`)).send({ token, password: PASSWORD })).status).toBe(400);
    });

    it('keeps only the newest link valid', async () => {
      const user = await seedUser(ctx.db, { account: 'ops.admin', password: null });
      const first = await issue(user.id, UserTokenPurpose.first_login);
      const second = await issue(user.id, UserTokenPurpose.first_login);
      expect((await fromSite(api(ctx.app).post(`${base}/verifyToken`)).send({ token: first.token })).status).toBe(400);
      expect((await fromSite(api(ctx.app).post(`${base}/verifyToken`)).send({ token: second.token })).status).toBe(200);
    });
  });

  describe('login, profile and logout (US2-3, US2-6)', () => {
    it('sets an httpOnly session cookie and a readable CSRF cookie, and returns the profile without internal fields', async () => {
      await seedUser(ctx.db, { account: 'ops.admin', groups: ['admin'] });
      const { response, cookie } = await signIn(ctx.app, 'OPS.Admin');
      const cookies = cookiesOf(response);
      expect(cookies.admin_session.raw).toMatch(/HttpOnly/i);
      expect(cookies.admin_session.raw).toMatch(/SameSite=Strict/i);
      expect(cookies.admin_session.raw).toMatch(/Path=\/api\/v1\/admin/);
      expect(cookies.admin_csrf.raw).not.toMatch(/HttpOnly/i);

      const profile = await api(ctx.app).get(`${base}/profile`).set('Cookie', cookie);
      expect(profile.status).toBe(200);
      expect(profile.body.data.user).toMatchObject({ account: 'ops.admin', status: true, invitationPending: false, groups: [expect.objectContaining({ code: 'admin' })] });
      expect(profile.body.data.permissions).toEqual(expect.arrayContaining([{ action: 'manage', subject: 'User' }, { action: 'manage', subject: 'Conversation' }]));
      expect(profile.body.data.permissions).not.toContainEqual({ action: 'manage', subject: 'all' });
      for (const body of [response.body, profile.body]) {
        for (const field of INTERNAL_USER_FIELDS) expect(JSON.stringify(body)).not.toContain(field);
      }
    });

    it('gives developers manage all', async () => {
      await seedUser(ctx.db, { account: 'dev.one', groups: ['developer'] });
      const { response } = await signIn(ctx.app, 'dev.one');
      expect(response.body.data.permissions).toEqual([{ action: 'manage', subject: 'all' }]);
    });

    it('gives custom groups exactly their permissions', async () => {
      await ctx.db.userGroup.create({ data: { name: '客服主管', permissions: ['Conversation:read', 'Feedback:read'] } });
      await seedUser(ctx.db, { account: 'cs.lead', groups: ['客服主管'] });
      const { response } = await signIn(ctx.app, 'cs.lead');
      expect(response.body.data.permissions).toEqual([{ action: 'read', subject: 'Conversation' }, { action: 'read', subject: 'Feedback' }]);
    });

    it('revokes the session on logout', async () => {
      await seedUser(ctx.db, { account: 'ops.admin', groups: ['admin'] });
      const signed = await signIn(ctx.app, 'ops.admin');
      const logout = await fromSite(api(ctx.app).post(`${base}/logout`), signed);
      expect(logout.status).toBe(200);
      expect(cookiesOf(logout).admin_session.raw).toMatch(/Expires=Thu, 01 Jan 1970/);
      expect((await api(ctx.app).get(`${base}/profile`).set('Cookie', signed.cookie)).status).toBe(401);
      expect(await auditTypes()).toEqual(['admin_login_succeeded', 'admin_logout']);
    });

    it('requires a session for profile', async () => {
      expect((await api(ctx.app).get(`${base}/profile`)).status).toBe(401);
      expect((await api(ctx.app).get(`${base}/profile`).set('Cookie', 'admin_session=not-a-token')).status).toBe(401);
    });
  });

  describe('failed login (US2-4, US2-5)', () => {
    it('answers unknown, wrong, disabled and not-yet-activated accounts identically, without recording the password', async () => {
      await seedUser(ctx.db, { account: 'ops.admin' });
      await seedUser(ctx.db, { account: 'gone.user', status: false });
      await seedUser(ctx.db, { account: 'new.user', password: null });
      const attempts = [['nobody', PASSWORD], ['ops.admin', 'wrong password!!'], ['gone.user', PASSWORD], ['new.user', PASSWORD]];
      const bodies = [];
      for (const [account, password] of attempts) {
        const response = await fromSite(api(ctx.app).post(`${base}/login`)).send({ account, password });
        expect(response.status).toBe(401);
        bodies.push(response.body.error);
      }
      expect(new Set(bodies.map((body) => JSON.stringify(body))).size).toBe(1);
      const events = await ctx.db.userAuditEvent.findMany();
      expect(events.map((event) => event.eventType)).toEqual(Array(4).fill('admin_login_failed'));
      expect(JSON.stringify(events)).not.toMatch(/correct horse battery|wrong password!!|nobody/);
    });

    it('locks the account for 15 minutes after 5 wrong passwords', async () => {
      await seedUser(ctx.db, { account: 'ops.admin' });
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await fromSite(api(ctx.app).post(`${base}/login`)).send({ account: 'ops.admin', password: 'wrong password!!' });
      }
      expect((await fromSite(api(ctx.app).post(`${base}/login`)).send({ account: 'ops.admin', password: PASSWORD })).status).toBe(401);
      ctx.clock.advance(15 * MINUTE + 1000);
      await signIn(ctx.app, 'ops.admin');
    });

    it('limits login attempts per IP', async () => {
      const statuses = [];
      for (let attempt = 0; attempt < 21; attempt += 1) {
        statuses.push((await fromSite(api(ctx.app).post(`${base}/login`)).send({ account: `nobody${attempt}`, password: PASSWORD })).status);
      }
      expect(statuses.slice(0, 20).every((status) => status === 401)).toBe(true);
      expect(statuses[20]).toBe(429);
    });

    it('limits login attempts per account', async () => {
      const statuses = [];
      for (let attempt = 0; attempt < 11; attempt += 1) {
        statuses.push((await fromSite(api(ctx.app).post(`${base}/login`)).send({ account: attempt % 2 ? 'OPS.admin' : 'ops.admin', password: 'wrong password!!' })).status);
      }
      expect(statuses.slice(0, 10).every((status) => status === 401)).toBe(true);
      const limited = await fromSite(api(ctx.app).post(`${base}/login`)).send({ account: 'ops.admin', password: PASSWORD });
      expect(statuses[10]).toBe(429);
      expect(limited.status).toBe(429);
      expect(limited.body.error).toEqual(expect.objectContaining({ code: 'TOO_MANY_REQUESTS', message: '嘗試次數過多，請稍後再試。' }));
    });
  });

  describe('session expiry and revocation (US2-7, US2-8)', () => {
    it('expires after 30 idle minutes', async () => {
      await seedUser(ctx.db, { account: 'ops.admin' });
      const { cookie } = await signIn(ctx.app, 'ops.admin');
      ctx.clock.advance(29 * MINUTE);
      expect((await api(ctx.app).get(`${base}/profile`).set('Cookie', cookie)).status).toBe(200);
      ctx.clock.advance(30 * MINUTE);
      expect((await api(ctx.app).get(`${base}/profile`).set('Cookie', cookie)).status).toBe(401);
    });

    it('expires 12 hours after login even when active', async () => {
      await seedUser(ctx.db, { account: 'ops.admin' });
      const { cookie } = await signIn(ctx.app, 'ops.admin');
      for (let elapsed = 0; elapsed < 12 * 60 - 20; elapsed += 20) {
        ctx.clock.advance(20 * MINUTE);
        expect((await api(ctx.app).get(`${base}/profile`).set('Cookie', cookie)).status).toBe(200);
      }
      ctx.clock.advance(20 * MINUTE);
      expect((await api(ctx.app).get(`${base}/profile`).set('Cookie', cookie)).status).toBe(401);
    });

    it('rejects a disabled user immediately', async () => {
      const user = await seedUser(ctx.db, { account: 'ops.admin' });
      const { cookie } = await signIn(ctx.app, 'ops.admin');
      await ctx.db.user.update({ where: { id: user.id }, data: { status: false } });
      expect((await api(ctx.app).get(`${base}/profile`).set('Cookie', cookie)).status).toBe(401);
    });
  });

  it('sends security headers (helmet) on every response', async () => {
    const response = await api(ctx.app).get(`${base}/profile`);
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('limits mail-link endpoints to 10 requests per minute per IP', async () => {
    const statuses = [];
    for (let attempt = 0; attempt < 11; attempt += 1) {
      statuses.push((await fromSite(api(ctx.app).post(`${base}/verifyToken`)).send({ token: 'x'.repeat(43) })).status);
    }
    expect(statuses.slice(0, 10).every((status) => status === 400)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  describe('CSRF and origin (US2-9)', () => {
    it('rejects state changes from another origin or without the CSRF header', async () => {
      await seedUser(ctx.db, { account: 'ops.admin' });
      const login = await api(ctx.app).post(`${base}/login`).set('Origin', 'https://evil.example.test').send({ account: 'ops.admin', password: PASSWORD });
      expect(login.status).toBe(403);
      expect((await api(ctx.app).post(`${base}/login`).send({ account: 'ops.admin', password: PASSWORD })).status).toBe(403);

      const signed = await signIn(ctx.app, 'ops.admin');
      expect((await api(ctx.app).post(`${base}/logout`).set('Origin', ADMIN_TEST_ORIGIN).set('Cookie', signed.cookie)).status).toBe(403);
      expect((await fromSite(api(ctx.app).post(`${base}/logout`), { ...signed, csrf: 'x'.repeat(43) })).status).toBe(403);
      expect((await fromSite(api(ctx.app).post(`${base}/logout`), signed)).status).toBe(200);
    });
  });

  describe('forgot and reset password (US2-10, US2-11)', () => {
    it('answers the same for unknown and known emails, and mails a reset link only to active users with a password', async () => {
      await seedUser(ctx.db, { account: 'ops.admin', email: 'ops@example.test' });
      await seedUser(ctx.db, { account: 'new.user', email: 'new@example.test', password: null });
      const answers = [];
      for (const email of ['nobody@example.test', 'OPS@example.test', 'new@example.test']) {
        const response = await fromSite(api(ctx.app).post(`${base}/forgot`)).send({ email });
        answers.push([response.status, response.body.data]);
      }
      await flush();
      expect(answers).toEqual(Array(3).fill([200, { accepted: true }]));
      expect(ctx.mail.sent.map((message) => message.to)).toEqual(['ops@example.test']);
      expect(ctx.mail.sent[0].text).toContain(`${ADMIN_TEST_ORIGIN}/auth/reset?token=`);
    });

    it('sends at most one reset mail per 15 minutes', async () => {
      await seedUser(ctx.db, { account: 'ops.admin', email: 'ops@example.test' });
      await fromSite(api(ctx.app).post(`${base}/forgot`)).send({ email: 'ops@example.test' });
      await fromSite(api(ctx.app).post(`${base}/forgot`)).send({ email: 'ops@example.test' });
      await flush();
      expect(ctx.mail.sent).toHaveLength(1);
      ctx.clock.advance(15 * MINUTE + 1000);
      await fromSite(api(ctx.app).post(`${base}/forgot`)).send({ email: 'ops@example.test' });
      await flush();
      expect(ctx.mail.sent).toHaveLength(2);
    });

    it('resets the password, signs the user out everywhere and expires the link after one hour', async () => {
      await seedUser(ctx.db, { account: 'ops.admin', email: 'ops@example.test' });
      const before = await signIn(ctx.app, 'ops.admin');
      await fromSite(api(ctx.app).post(`${base}/forgot`)).send({ email: 'ops@example.test' });
      await flush();
      const token = ctx.mail.lastToken('ops@example.test')!;

      expect((await fromSite(api(ctx.app).post(`${base}/verifyToken`)).send({ token })).body.data).toEqual({ account: 'ops.admin', purpose: 'reset_password' });
      expect((await fromSite(api(ctx.app).post(`${base}/reset`)).send({ token, password: NEW_PASSWORD })).status).toBe(200);
      expect((await api(ctx.app).get(`${base}/profile`).set('Cookie', before.cookie)).status).toBe(401);
      expect((await fromSite(api(ctx.app).post(`${base}/login`)).send({ account: 'ops.admin', password: PASSWORD })).status).toBe(401);
      await signIn(ctx.app, 'ops.admin', NEW_PASSWORD);

      ctx.clock.advance(16 * MINUTE);
      await fromSite(api(ctx.app).post(`${base}/forgot`)).send({ email: 'ops@example.test' });
      await flush();
      const late = ctx.mail.lastToken('ops@example.test')!;
      ctx.clock.advance(60 * MINUTE + 1000);
      expect((await fromSite(api(ctx.app).post(`${base}/reset`)).send({ token: late, password: PASSWORD })).status).toBe(400);
    });
  });

  describe('changing one\'s own password (PUT auth/profile)', () => {
    const change = (signed: Awaited<ReturnType<typeof signIn>>, body: object) => fromSite(api(ctx.app).put(`${base}/profile`), signed).send(body);

    it('changes the password, keeps this session, signs out the others and voids reset links', async () => {
      await seedUser(ctx.db, { account: 'ops.admin', email: 'ops@example.test' });
      const here = await signIn(ctx.app, 'ops.admin');
      const elsewhere = await signIn(ctx.app, 'ops.admin');
      await fromSite(api(ctx.app).post(`${base}/forgot`)).send({ email: 'ops@example.test' });
      await flush();
      const resetToken = ctx.mail.lastToken('ops@example.test')!;

      const changed = await change(here, { currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
      expect(changed.status).toBe(200);
      expect(changed.body.data).toBeNull();
      expect((await api(ctx.app).get(`${base}/profile`).set('Cookie', here.cookie)).status).toBe(200);
      expect((await api(ctx.app).get(`${base}/profile`).set('Cookie', elsewhere.cookie)).status).toBe(401);
      expect((await fromSite(api(ctx.app).post(`${base}/verifyToken`)).send({ token: resetToken })).status).toBe(400);
      expect((await fromSite(api(ctx.app).post(`${base}/login`)).send({ account: 'ops.admin', password: PASSWORD })).status).toBe(401);
      await signIn(ctx.app, 'ops.admin', NEW_PASSWORD);
      expect(await auditTypes()).toContain('admin_password_changed');
    });

    it('rejects a wrong current password, an unchanged one and one that breaks the rules', async () => {
      await seedUser(ctx.db, { account: 'ops.admin' });
      const signed = await signIn(ctx.app, 'ops.admin');
      const wrong = await change(signed, { currentPassword: 'not my password', newPassword: NEW_PASSWORD });
      expect(wrong.status).toBe(400);
      expect(wrong.body.error.code).toBe('CURRENT_PASSWORD_INCORRECT');
      expect((await change(signed, { currentPassword: PASSWORD, newPassword: PASSWORD })).body.error.code).toBe('PASSWORD_UNCHANGED');
      expect((await change(signed, { currentPassword: PASSWORD, newPassword: 'short' })).body.error.code).toBe('PASSWORD_TOO_SHORT');
      expect((await change(signed, { currentPassword: PASSWORD, newPassword: 'ops.admin' })).status).toBe(400);
      expect(await auditTypes()).not.toContain('admin_password_changed');
    });

    it('requires a session and the CSRF header', async () => {
      expect((await fromSite(api(ctx.app).put(`${base}/profile`)).send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD })).status).toBe(401);
      await seedUser(ctx.db, { account: 'ops.admin' });
      const signed = await signIn(ctx.app, 'ops.admin');
      const noCsrf = await api(ctx.app).put(`${base}/profile`).set('Origin', ADMIN_TEST_ORIGIN).set('Cookie', signed.cookie).send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
      expect(noCsrf.status).toBe(403);
    });
  });

  it('never stores or logs plain passwords, session tokens or link tokens (SC-003)', async () => {
    const user = await seedUser(ctx.db, { account: 'ops.admin', password: null, email: 'ops@example.test' });
    const { token } = await issue(user.id, UserTokenPurpose.first_login);
    await fromSite(api(ctx.app).post(`${base}/firstLogin`)).send({ token, password: PASSWORD });
    const signed = await signIn(ctx.app, 'ops.admin');
    const sessionToken = signed.cookie.match(/admin_session=([^;]+)/)![1];

    const dump = JSON.stringify({
      users: await ctx.db.user.findMany(),
      sessions: await ctx.db.userSession.findMany(),
      tokens: await ctx.db.userToken.findMany(),
      audit: await ctx.db.userAuditEvent.findMany()
    });
    for (const secret of [PASSWORD, sessionToken, token]) expect(dump).not.toContain(secret);
  });
});

describeDbBackedAdmin('admin bootstrap (Feature 014 US1)', () => {
  let ctx: AdminTestContext;
  beforeEach(async () => { ctx = await createAdminTestApp(); await resetAdminTables(ctx.db); await ctx.db.userGroup.deleteMany({}); });
  afterEach(async () => { await closeAdminTestApp(ctx); });

  it('creates the built-in groups and the first developer once, printing the first-login link', async () => {
    await configureAdminTestEnvironment();
    const lines: string[] = [];
    await expect(runAdminBootstrap(['--account', 'Dev.One', '--name', '開發者', '--email', 'Dev@Example.test'], (line) => lines.push(line))).resolves.toBe(0);

    const user = await ctx.db.user.findUniqueOrThrow({ where: { account: 'dev.one' }, include: { groups: true } });
    expect(user).toMatchObject({ email: 'dev@example.test', passwordHash: null, status: true });
    expect(user.groups.map((group) => group.code)).toEqual(['developer']);
    expect((await ctx.db.userGroup.findMany({ orderBy: { code: 'asc' } })).map((group) => [group.code, group.isSystem])).toEqual([['admin', true], ['developer', true]]);
    expect(lines.join('\n')).toMatch(new RegExp(`${ADMIN_TEST_ORIGIN}/auth/firstLogin\\?token=[A-Za-z0-9_-]{43}`));
    expect((await ctx.db.userAuditEvent.findMany()).map((event) => event.eventType)).toEqual(['admin_bootstrap']);

    await expect(runAdminBootstrap(['--account', 'dev.two', '--name', 'B', '--email', 'b@example.test'], () => undefined)).resolves.toBe(1);
    expect(await ctx.db.user.count()).toBe(1);
  });

  it.each([
    [['--account', 'x', '--name', 'A', '--email', 'a@example.test']],
    [['--account', 'dev.one', '--name', 'A', '--email', 'not-an-email']],
    [['--account', 'dev.one', '--name', 'A']]
  ])('rejects invalid arguments %p', async (argv) => {
    await expect(runAdminBootstrap(argv, () => undefined)).rejects.toThrow();
    expect(await ctx.db.user.count()).toBe(0);
  });
});
