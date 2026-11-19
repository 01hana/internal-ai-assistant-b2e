import { OTHER_TEST_CUSTOMER, resetOperationsData, seedConversation } from '../support/admin-operations.fixture';
import {
  api, type AdminTestContext, closeAdminTestApp, createAdminTestApp, describeDbBackedAdmin, fromSite, resetAdminTables, seedUser,
  type Signed, signIn, signInWithPermissions
} from '../support/admin-test-app.helper';

/** Feature 015 US4 (T011, T013): review items in the admin API. */
jest.setTimeout(60_000);

describeDbBackedAdmin('admin review items (Feature 015)', () => {
  let ctx: AdminTestContext;
  let admin: Signed;
  let developer: Signed;
  let ids: Record<'noAnswer' | 'unsupported' | 'other', string>;
  let sessions: Record<'noAnswer' | 'unsupported', string>;
  const base = '/api/v1/admin/reviewItems';

  beforeEach(async () => {
    ctx = await createAdminTestApp();
    await resetAdminTables(ctx.db);
    await resetOperationsData(ctx.db);
    await seedUser(ctx.db, { account: 'ops.admin', groups: ['admin'] });
    await seedUser(ctx.db, { account: 'dev.one', groups: ['developer'] });
    admin = await signIn(ctx.app, 'ops.admin');
    developer = await signIn(ctx.app, 'dev.one');
    const noAnswer = await seedConversation(ctx.db, {
      exchanges: [{ question: '庫存還有多少？', answer: '目前無法回答。', decision: 'no_answer', at: new Date('2026-11-11T02:00:00Z'), review: { sourceType: 'no_answer', on: 'answer' } }]
    });
    const unsupported = await seedConversation(ctx.db, {
      exchanges: [{ question: '幫我訂機票', at: new Date('2026-11-12T02:00:00Z'), review: { sourceType: 'unsupported_question', on: 'question' } }]
    });
    const other = await seedConversation(ctx.db, {
      customerId: OTHER_TEST_CUSTOMER, exchanges: [{ question: '別的客戶', answer: '別的回答', decision: 'no_answer', at: new Date('2026-11-12T03:00:00Z'), review: { sourceType: 'no_answer', on: 'answer' } }]
    });
    ids = { noAnswer: noAnswer.exchanges[0].reviewItemId!, unsupported: unsupported.exchanges[0].reviewItemId!, other: other.exchanges[0].reviewItemId! };
    sessions = { noAnswer: noAnswer.sessionId, unsupported: unsupported.sessionId };
  });
  afterEach(async () => { await closeAdminTestApp(ctx); });

  const table = (body: object = {}, signed = admin) => fromSite(api(ctx.app).post(`${base}/getTable`), signed).send(body);
  const read = (id: string, signed = admin) => api(ctx.app).get(`${base}/${id}`).set('Cookie', signed.cookie);
  const batch = (body: object, signed = admin) => fromSite(api(ctx.app).patch(`${base}/batch`), signed).send(body);
  const idsOf = (response: { body: { data: { items: Array<{ id: string }> } } }) => response.body.data.items.map((item) => item.id);

  describe('list (US4-1, US4-2)', () => {
    it('lists open items of this customer with their conversation, without text or suggestions', async () => {
      const { body } = await table().expect(200);
      expect(idsOf({ body })).toEqual([ids.unsupported, ids.noAnswer]);
      expect(body.data.items[0]).toMatchObject({ sourceType: 'unsupported_question', status: 'open', priority: 'medium', sessionId: sessions.unsupported, note: null });
      expect(body.data.items[1]).toMatchObject({ sourceType: 'no_answer', sessionId: sessions.noAnswer });
      expect(JSON.stringify(body)).not.toMatch(/庫存|機票|別的|suggestedImprovement|kpi\.query/);
    });

    it('filters by type, status and period, and offers the options', async () => {
      expect(idsOf(await table({ filters: { sourceType: ['unsupported_question'] } }))).toEqual([ids.unsupported]);
      expect(idsOf(await table({ filters: { status: ['resolved'] } }))).toEqual([]);
      expect(idsOf(await table({ filters: { to: '2026-11-12T00:00:00Z' } }))).toEqual([ids.noAnswer]);
      expect(idsOf(await table({ sort: { field: 'createdAt', order: 'asc' } }))).toEqual([ids.noAnswer, ids.unsupported]);
      await table({ filters: { sourceType: ['typo'] } }).expect(400);
      const { body } = await api(ctx.app).get(`${base}/getFilters`).set('Cookie', admin.cookie).expect(200);
      expect(body.data.sourceType).toContainEqual({ value: 'unsupported_question', label: '不支援的問題' });
      expect(body.data.status.map((option: { value: string }) => option.value)).toEqual(['open', 'in_review', 'resolved', 'dismissed']);
      expect(body.data.priority).toHaveLength(3);
    });
  });

  describe('detail (US4-3, SC-002, SC-003)', () => {
    it('adds the exchange for Conversation:read and audits it', async () => {
      const { body } = await read(ids.noAnswer).expect(200);
      expect(body.data).toMatchObject({ suggestedImprovement: { toolName: 'kpi.query' }, history: [] });
      expect(body.data.conversation).toMatchObject({ question: { content: '庫存還有多少？' }, answer: { content: '目前無法回答。', answerDecision: 'no_answer' } });

      const unsupported = await read(ids.unsupported).expect(200);
      expect(unsupported.body.data.conversation).toMatchObject({ question: { content: '幫我訂機票' }, answer: null });

      const events = await ctx.db.userAuditEvent.findMany({ where: { eventType: 'admin_conversation_viewed' } });
      expect(events.map((event) => event.metadata)).toEqual(expect.arrayContaining([expect.objectContaining({ via: 'reviewItem' })]));
      expect(events).toHaveLength(2);
    });

    it('leaves the exchange out without Conversation:read, and hides other customers\' items', async () => {
      const reviewer = await signInWithPermissions(ctx, 'reviewer', ['ReviewItem:read', 'ReviewItem:update']);
      const { body } = await read(ids.noAnswer, reviewer).expect(200);
      expect(body.data.conversation).toBeNull();
      expect(JSON.stringify(body)).not.toContain('庫存');
      await read(ids.other).expect(404);
    });
  });

  describe('handling (US4-4, US4-5)', () => {
    it('updates the status of several items, keeps resolvedAt while closed and clears it when reopened', async () => {
      expect((await batch({ ids: [ids.noAnswer, ids.unsupported], status: 'resolved', note: ' 已補上庫存資料來源 ' }).expect(200)).body.data).toEqual({ updated: 2 });
      const resolved = await ctx.db.reviewItem.findUniqueOrThrow({ where: { id: ids.noAnswer } });
      expect(resolved).toMatchObject({ status: 'resolved', note: '已補上庫存資料來源', resolvedAt: ctx.clock.now() });

      ctx.clock.advance(60_000);
      await batch({ ids: [ids.noAnswer], status: 'dismissed' }).expect(200);
      expect(await ctx.db.reviewItem.findUniqueOrThrow({ where: { id: ids.noAnswer } })).toMatchObject({ status: 'dismissed', resolvedAt: resolved.resolvedAt, note: '已補上庫存資料來源' });

      await batch({ ids: [ids.noAnswer], status: 'in_review', note: '重新確認' }).expect(200);
      expect(await ctx.db.reviewItem.findUniqueOrThrow({ where: { id: ids.noAnswer } })).toMatchObject({ status: 'in_review', resolvedAt: null, note: '重新確認' });

      const { body } = await read(ids.noAnswer).expect(200);
      expect(body.data.history.map((entry: { before: string; after: string; note: string | null }) => [entry.before, entry.after, entry.note])).toEqual([
        ['open', 'resolved', '已補上庫存資料來源'], ['resolved', 'dismissed', null], ['dismissed', 'in_review', '重新確認']
      ]);
      expect(body.data.history[0].actor).toEqual({ account: 'ops.admin', label: 'ops.admin' });
    });

    it('changes nothing when any item is missing or belongs to another customer', async () => {
      const missing = await batch({ ids: [ids.noAnswer, ids.other, 'missing'], status: 'dismissed' }).expect(404);
      expect(missing.body.error).toMatchObject({ code: 'REVIEW_ITEM_NOT_FOUND', details: { ids: [ids.other, 'missing'] } });
      expect(await ctx.db.reviewItem.count({ where: { status: 'dismissed' } })).toBe(0);
      expect(await ctx.db.userAuditEvent.count({ where: { eventType: 'admin_review_item_updated' } })).toBe(0);
      await batch({ ids: [ids.noAnswer], status: 'done' }).expect(400);
      await batch({ ids: [ids.noAnswer], status: 'resolved', note: 'x'.repeat(501) }).expect(400);
    });

    it('shows developers as 開發工程師 in the history to everyone else (SC-006)', async () => {
      await batch({ ids: [ids.noAnswer], status: 'in_review' }, developer).expect(200);
      expect((await read(ids.noAnswer).expect(200)).body.data.history[0].actor).toEqual({ account: null, label: '開發工程師' });
      expect((await read(ids.noAnswer, developer).expect(200)).body.data.history[0].actor).toEqual({ account: 'dev.one', label: 'dev.one' });
    });
  });

  it('requires ReviewItem:read to look and ReviewItem:update to change (SC-001)', async () => {
    const reader = await signInWithPermissions(ctx, 'review.reader', ['ReviewItem:read']);
    await table({}, reader).expect(200);
    await batch({ ids: [ids.noAnswer], status: 'resolved' }, reader).expect(403);
    const outsider = await signInWithPermissions(ctx, 'outsider', ['Conversation:read', 'Feedback:read']);
    await table({}, outsider).expect(403);
    await read(ids.noAnswer, outsider).expect(403);
  });
});
