import { OTHER_TEST_CUSTOMER, resetOperationsData, seedConversation } from '../support/admin-operations.fixture';
import {
  api, type AdminTestContext, closeAdminTestApp, createAdminTestApp, describeDbBackedAdmin, fromSite, resetAdminTables, seedUser,
  type Signed, signIn, signInWithPermissions
} from '../support/admin-test-app.helper';

/** Feature 015 US5 (T015, T016): Assistant and back-office audit in the admin API. */
jest.setTimeout(60_000);

describeDbBackedAdmin('admin audit events (Feature 015)', () => {
  let ctx: AdminTestContext;
  let admin: Signed;
  let developer: Signed;
  let sessionId: string;

  beforeEach(async () => {
    ctx = await createAdminTestApp();
    await resetAdminTables(ctx.db);
    await resetOperationsData(ctx.db);
    await seedUser(ctx.db, { account: 'ops.admin', groups: ['admin'] });
    await seedUser(ctx.db, { account: 'dev.one', groups: ['developer'], email: 'dev.one@vendor.test' });
    admin = await signIn(ctx.app, 'ops.admin');
    developer = await signIn(ctx.app, 'dev.one');
    ({ sessionId } = await seedConversation(ctx.db, { actorId: 'actor-1', exchanges: [{ question: '本月出貨量？', answer: '120 件。', at: new Date('2026-11-10T02:00:00Z') }] }));
    await seedConversation(ctx.db, { customerId: OTHER_TEST_CUSTOMER, actorId: 'actor-x', exchanges: [{ question: 'x', answer: 'x', at: new Date('2026-11-10T03:00:00Z') }] });
  });
  afterEach(async () => { await closeAdminTestApp(ctx); });

  const table = (path: string, body: object = {}, signed = admin) => fromSite(api(ctx.app).post(`/api/v1/admin/${path}/getTable`), signed).send(body);
  const filters = (path: string, signed = admin) => api(ctx.app).get(`/api/v1/admin/${path}/getFilters`).set('Cookie', signed.cookie);

  describe('Assistant audit (US5-1)', () => {
    it('lists this customer\'s events without metadata', async () => {
      const { body } = await table('auditEvents').expect(200);
      expect(body.data.total).toBe(2);
      expect(body.data.items.map((event: { eventType: string }) => event.eventType)).toEqual(['final', 'message_received']);
      expect(body.data.items[0]).toEqual({
        id: expect.any(String), timestamp: '2026-11-10T02:00:01.000Z', eventType: 'final', requestId: expect.any(String), actorId: 'actor-1',
        organizationId: 'org-1', hostApp: 'scm', sessionId, messageId: expect.any(String), decision: 'answered', durationMs: 1200
      });
      expect(JSON.stringify(body)).not.toMatch(/not for the admin API|actor-x/);
    });

    it('filters by event type, actor, conversation, request and period, and offers the event types', async () => {
      const count = async (filtersBody: object) => (await table('auditEvents', { filters: filtersBody })).body.data.total;
      expect(await count({ eventType: ['final'] })).toBe(1);
      expect(await count({ actorId: 'actor-2' })).toBe(0);
      expect(await count({ sessionId })).toBe(2);
      const [first] = (await table('auditEvents')).body.data.items;
      expect(await count({ requestId: first.requestId })).toBe(2);
      expect(await count({ from: '2026-11-10T02:00:01Z' })).toBe(1);
      expect((await filters('auditEvents').expect(200)).body.data.eventType).toEqual([
        { value: 'final', label: 'final' }, { value: 'message_received', label: 'message_received' }
      ]);
    });
  });

  describe('back-office audit (US5-2, SC-006)', () => {
    const adminEvents = async (signed: Signed, body: object = {}) =>
      (await table('adminAuditEvents', body, signed).expect(200)).body.data.items as Array<{ eventType: string; actor: { account: string | null; label: string }; targetId: string | null; metadata: unknown }>;

    it('shows developers to developers', async () => {
      const logins = await adminEvents(developer, { filters: { eventType: ['admin_login_succeeded'] } });
      expect(logins.map((event) => event.actor.account).sort()).toEqual(['dev.one', 'ops.admin']);
    });

    it('shows developers as 開發工程師 to everyone else, without the target or its details', async () => {
      const devUser = await ctx.db.user.findUniqueOrThrow({ where: { account: 'dev.one' } });
      await ctx.db.userAuditEvent.create({
        data: { requestId: 'req-dev-email', actorUserId: devUser.id, actorAccount: 'dev.one', actorIsDeveloper: true, eventType: 'admin_user_email_changed',
          targetType: 'User', targetId: devUser.id, targetIsDeveloper: true, metadata: { account: 'dev.one', before: 'dev.one@vendor.test', after: 'dev@vendor.test' } }
      });
      const events = await adminEvents(admin);
      const developerEvents = events.filter((event) => event.actor.label === '開發工程師');
      expect(developerEvents.length).toBeGreaterThanOrEqual(2);
      for (const event of developerEvents) expect(event.actor.account).toBeNull();
      expect(events.find((event) => event.eventType === 'admin_user_email_changed')).toMatchObject({ targetId: null, metadata: null });
      expect(JSON.stringify(events)).not.toMatch(/dev\.one|vendor\.test/);

      expect(await adminEvents(admin, { filters: { actorAccount: 'dev.one' } })).toEqual([]);
      expect((await adminEvents(admin, { filters: { actorAccount: 'ops.admin' } })).map((event) => event.actor.account)).toEqual(['ops.admin']);
      expect(await adminEvents(developer, { filters: { actorAccount: 'dev.one' } })).not.toEqual([]);
    });

    it('offers the labelled event types and rejects unknown ones', async () => {
      const { body } = await filters('adminAuditEvents').expect(200);
      expect(body.data.eventType).toContainEqual({ value: 'admin_conversation_viewed', label: '查看對話內容' });
      await table('adminAuditEvents', { filters: { eventType: ['admin_magic'] } }).expect(400);
    });
  });

  it('requires AuditEvent:read for both, and offers no way to change audit (SC-001)', async () => {
    const reader = await signInWithPermissions(ctx, 'auditor', ['AuditEvent:read']);
    await table('auditEvents', {}, reader).expect(200);
    await table('adminAuditEvents', {}, reader).expect(200);
    const outsider = await signInWithPermissions(ctx, 'outsider', ['Conversation:read', 'Stats:read']);
    await table('auditEvents', {}, outsider).expect(403);
    await table('adminAuditEvents', {}, outsider).expect(403);
    await filters('auditEvents', outsider).expect(403);
    for (const method of ['delete', 'patch', 'put'] as const) {
      await fromSite(api(ctx.app)[method]('/api/v1/admin/auditEvents'), admin).send({ ids: ['x'] }).expect(404);
      await fromSite(api(ctx.app)[method]('/api/v1/admin/adminAuditEvents'), admin).send({ ids: ['x'] }).expect(404);
    }
  });
});
