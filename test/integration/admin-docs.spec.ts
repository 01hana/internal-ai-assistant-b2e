import { api, type AdminTestContext, closeAdminTestApp, createAdminTestApp, describeDbBackedAdmin } from '../support/admin-test-app.helper';

/** Feature 014: Swagger UI for local testing of the admin API — off by default, on only when enabled. */
jest.setTimeout(60_000);

describeDbBackedAdmin('admin API docs (Feature 014)', () => {
  let ctx: AdminTestContext | undefined;
  afterEach(async () => { await closeAdminTestApp(ctx); ctx = undefined; });

  it('serves no docs by default', async () => {
    ctx = await createAdminTestApp();
    await api(ctx.app).get('/api/v1/admin/docs-json').expect(404);
  });

  it('documents the admin routes with session cookie and CSRF header auth when enabled', async () => {
    ctx = await createAdminTestApp({ ADMIN_ENABLE_SWAGGER_DOCS: 'true' });
    const { body } = await api(ctx.app).get('/api/v1/admin/docs-json').expect(200);
    expect(Object.keys(body.paths)).toEqual(expect.arrayContaining(['/api/v1/admin/auth/login', '/api/v1/admin/groups/getTable']));
    expect(body.components.securitySchemes).toEqual({
      session: { type: 'apiKey', in: 'cookie', name: 'admin_session' },
      csrf: { type: 'apiKey', in: 'header', name: 'x-csrf-token' }
    });
    expect(body.security).toEqual([{ session: [] }, { csrf: [] }]);
    await api(ctx.app).get('/api/v1/admin/docs').expect(200);
  });
});
