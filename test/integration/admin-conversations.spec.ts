import { UserAuditService } from '../../src/admin/audit/user-audit.service';
import { OTHER_TEST_CUSTOMER, resetOperationsData, seedConversation } from '../support/admin-operations.fixture';
import {
  ADMIN_TEST_CUSTOMER, api, type AdminTestContext, closeAdminTestApp, createAdminTestApp, describeDbBackedAdmin, fromSite,
  resetAdminTables, seedUser, type Signed, signIn, signInWithPermissions
} from '../support/admin-test-app.helper';

/** Feature 015 US1 (T006, T008): conversations in the admin API. */
jest.setTimeout(60_000);

describeDbBackedAdmin('admin conversations (Feature 015)', () => {
  let ctx: AdminTestContext;
  let admin: Signed;
  let ids: Record<'shipped' | 'stock' | 'deleted' | 'other', string>;
  const base = '/api/v1/admin/conversations';

  beforeEach(async () => {
    ctx = await createAdminTestApp();
    await resetAdminTables(ctx.db);
    await resetOperationsData(ctx.db);
    await seedUser(ctx.db, { account: 'ops.admin', groups: ['admin'] });
    admin = await signIn(ctx.app, 'ops.admin');
    const shipped = await seedConversation(ctx.db, {
      actorId: 'actor-1', exchanges: [{ question: '本月出貨量是多少？', answer: '本月出貨 120 件。', at: new Date('2026-11-10T02:00:00Z'), feedback: { rating: 'negative', reason: 'wrong' } }]
    });
    const stock = await seedConversation(ctx.db, {
      actorId: 'actor-2', hostApp: 'crm',
      exchanges: [{ question: '庫存還有多少？', answer: '目前無法回答。', decision: 'no_answer', at: new Date('2026-11-11T02:00:00Z'), review: { sourceType: 'no_answer', on: 'answer' } }]
    });
    const deleted = await seedConversation(ctx.db, { actorId: 'actor-1', status: 'deleted', exchanges: [{ question: '已刪除的對話', answer: '好的。', at: new Date('2026-11-12T02:00:00Z') }] });
    const other = await seedConversation(ctx.db, { customerId: OTHER_TEST_CUSTOMER, hostApp: 'other-app', exchanges: [{ question: '別的客戶的問題', answer: '別的客戶的回答', at: new Date('2026-11-12T03:00:00Z') }] });
    ids = { shipped: shipped.sessionId, stock: stock.sessionId, deleted: deleted.sessionId, other: other.sessionId };
  });
  afterEach(async () => { await closeAdminTestApp(ctx); });

  const table = (body: object = {}, signed = admin) => fromSite(api(ctx.app).post(`${base}/getTable`), signed).send(body);
  const read = (id: string, signed = admin) => api(ctx.app).get(`${base}/${id}`).set('Cookie', signed.cookie);
  const idsOf = (response: { body: { data: { items: Array<{ id: string }> } } }) => response.body.data.items.map((item) => item.id);
  const viewed = () => ctx.db.userAuditEvent.findMany({ where: { eventType: 'admin_conversation_viewed' } });

  describe('list (US1-1, US1-2)', () => {
    it('lists this customer\'s conversations, newest first, without deleted ones by default', async () => {
      const { body } = await table().expect(200);
      expect(idsOf({ body })).toEqual([ids.stock, ids.shipped]);
      expect(body.data.total).toBe(2);
      expect(body.data.items[1]).toMatchObject({
        title: '本月出貨量是多少？', actorId: 'actor-1', organizationId: 'org-1', hostApp: 'scm', status: 'active',
        messageCount: 1, hasNegativeFeedback: true, hasUnanswered: false
      });
      expect(body.data.items[0]).toMatchObject({ hasNegativeFeedback: false, hasUnanswered: true });
    });

    it('filters, searches and sorts', async () => {
      expect(idsOf(await table({ filters: { status: ['deleted'] } }))).toEqual([ids.deleted]);
      expect(idsOf(await table({ filters: { hostApp: 'crm' } }))).toEqual([ids.stock]);
      expect(idsOf(await table({ filters: { actorId: 'actor-1' } }))).toEqual([ids.shipped]);
      expect(idsOf(await table({ filters: { hasNegativeFeedback: true } }))).toEqual([ids.shipped]);
      expect(idsOf(await table({ filters: { hasUnanswered: false } }))).toEqual([ids.shipped]);
      expect(idsOf(await table({ keyword: '庫存' }))).toEqual([ids.stock]);
      expect(idsOf(await table({ filters: { from: '2026-11-11T00:00:00Z', to: '2026-11-12T00:00:00Z' } }))).toEqual([ids.stock]);
      expect(idsOf(await table({ sort: { field: 'createdAt', order: 'asc' } }))).toEqual([ids.shipped, ids.stock]);
      await table({ sort: { field: 'actorId', order: 'asc' } }).expect(400);
      await table({ filters: { status: ['archived'] } }).expect(400);
    });

    it('offers this customer\'s host apps and the status options', async () => {
      const { body } = await api(ctx.app).get(`${base}/getFilters`).set('Cookie', admin.cookie).expect(200);
      expect(body.data.hostApps).toEqual([{ value: 'crm', label: 'crm' }, { value: 'scm', label: 'scm' }]);
      expect(body.data.status).toContainEqual({ value: 'deleted', label: '使用者已刪除' });
    });
  });

  describe('content (US1-3, SC-003, SC-004)', () => {
    it('returns the messages with feedback and review items, and records every read', async () => {
      const { body } = await read(ids.stock).expect(200);
      expect(body.data).toMatchObject({ id: ids.stock, status: 'active', truncated: false });
      expect(body.data.messages.map((message: { role: string; content: string }) => [message.role, message.content]))
        .toEqual([['user', '庫存還有多少？'], ['assistant', '目前無法回答。']]);
      expect(body.data.messages[1]).toMatchObject({ answerDecision: 'no_answer', reviewItems: [{ sourceType: 'no_answer', status: 'open' }] });

      const shipped = await read(ids.shipped).expect(200);
      expect(shipped.body.data.messages[1].feedback).toEqual([expect.objectContaining({ rating: 'negative', reason: 'wrong' })]);

      await read(ids.stock).expect(200);
      const events = await viewed();
      expect(events.map((event) => event.targetId).sort()).toEqual([ids.shipped, ids.stock, ids.stock].sort());
      expect(events[0]).toMatchObject({ targetType: 'AssistantSession', metadata: { via: 'conversation' } });
    });

    it('shows conversations the user deleted, and hides other customers\' conversations', async () => {
      expect((await read(ids.deleted).expect(200)).body.data.status).toBe('deleted');
      await read(ids.other).expect(404);
      await read('missing').expect(404);
      expect(JSON.stringify((await table({ filters: { status: ['active', 'closed', 'expired', 'deleted'] } })).body)).not.toContain('別的客戶');
    });

    it('returns no content when the read cannot be audited', async () => {
      jest.spyOn(ctx.app.get(UserAuditService), 'record').mockRejectedValueOnce(new Error('audit store unavailable'));
      const response = await read(ids.stock);
      expect(response.status).toBe(500);
      expect(JSON.stringify(response.body)).not.toContain('庫存');
    });

    it('returns the newest 500 messages and says so', async () => {
      const session = await ctx.db.assistantSession.create({ data: { customerId: ADMIN_TEST_CUSTOMER, organizationId: 'org-1', hostApp: 'scm', actorId: 'actor-9' } });
      await ctx.db.assistantMessage.createMany({
        data: Array.from({ length: 501 }, (_, index) => ({
          customerId: ADMIN_TEST_CUSTOMER, sessionId: session.id, requestId: `bulk-${index}`, role: 'user' as const,
          content: `問題 ${index}`, createdAt: new Date(Date.UTC(2026, 10, 1, 0, 0, index))
        }))
      });
      const { body } = await read(session.id).expect(200);
      expect(body.data.truncated).toBe(true);
      expect(body.data.messages).toHaveLength(500);
      expect(body.data.messages[0].content).toBe('問題 1');
      expect(body.data.messages[499].content).toBe('問題 500');
    });
  });

  describe('permissions (SC-001)', () => {
    it('requires Conversation:read for the list, the filters and the content', async () => {
      const statsOnly = await signInWithPermissions(ctx, 'stats.reader', ['Stats:read', 'Feedback:read', 'ReviewItem:read']);
      await table({}, statsOnly).expect(403);
      await api(ctx.app).get(`${base}/getFilters`).set('Cookie', statsOnly.cookie).expect(403);
      await read(ids.stock, statsOnly).expect(403);
      expect(await viewed()).toHaveLength(0);

      const auditor = await signInWithPermissions(ctx, 'conversation.auditor', ['Conversation:read']);
      await table({}, auditor).expect(200);
      await read(ids.stock, auditor).expect(200);
    });
  });
});
