import { api, type AdminTestContext, closeAdminTestApp, createAdminTestApp, describeDbBackedAdmin, fromSite, resetAdminTables, seedUser } from '../support/admin-test-app.helper';

/** Feature 014: HTTP setup of the admin API (configureAdminApp) — Swagger UI and reverse-proxy client IPs. */
jest.setTimeout(60_000);

describeDbBackedAdmin('admin API setup (Feature 014)', () => {
  let ctx: AdminTestContext | undefined;
  afterEach(async () => { await closeAdminTestApp(ctx); ctx = undefined; });

  describe('Swagger UI (local development only)', () => {
    it('serves no docs by default', async () => {
      ctx = await createAdminTestApp();
      await api(ctx.app).get('/api/v1/admin/docs-json').expect(404);
    });

    it('documents the admin routes with session cookie and CSRF header auth when enabled', async () => {
      ctx = await createAdminTestApp({ ADMIN_ENABLE_SWAGGER_DOCS: 'true' });
      const { body } = await api(ctx.app).get('/api/v1/admin/docs-json').expect(200);
      expect(Object.keys(body.paths)).toEqual(expect.arrayContaining(['/api/v1/admin/auth/login', '/api/v1/admin/groups/getTable', '/api/v1/admin/users/getTable']));
      expect(body.components.securitySchemes).toEqual({
        session: { type: 'apiKey', in: 'cookie', name: 'admin_session' },
        csrf: { type: 'apiKey', in: 'header', name: 'x-csrf-token' }
      });
      expect(body.security).toEqual([{ session: [] }, { csrf: [] }]);
      await api(ctx.app).get('/api/v1/admin/docs').expect(200);
    });
  });

  describe('client IP behind a reverse proxy', () => {
    const loginIp = async (env: Record<string, string>) => {
      ctx = await createAdminTestApp(env);
      await resetAdminTables(ctx.db);
      await seedUser(ctx.db, { account: 'ops.admin', groups: ['admin'] });
      await fromSite(api(ctx.app).post('/api/v1/admin/auth/login')).set('X-Forwarded-For', '203.0.113.7')
        .send({ account: 'ops.admin', password: 'correct horse battery' }).expect(200);
      return (await ctx.db.userAuditEvent.findFirstOrThrow({ where: { eventType: 'admin_login_succeeded' } })).ipSummary;
    };

    it('ignores X-Forwarded-For unless the proxy is trusted', async () => {
      expect(await loginIp({})).not.toBe('203.0.113.7');
    });

    it('uses the client IP the trusted proxy forwards', async () => {
      expect(await loginIp({ ADMIN_TRUSTED_PROXY_HOPS: '1' })).toBe('203.0.113.7');
    });
  });
});
