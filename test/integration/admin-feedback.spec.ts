import { OTHER_TEST_CUSTOMER, resetOperationsData, seedConversation } from '../support/admin-operations.fixture';
import {
  api, type AdminTestContext, closeAdminTestApp, createAdminTestApp, describeDbBackedAdmin, fromSite, resetAdminTables, seedUser,
  type Signed, signIn, signInWithPermissions
} from '../support/admin-test-app.helper';

/** Feature 015 US3 (T010, T013): feedback in the admin API. */
jest.setTimeout(60_000);

describeDbBackedAdmin('admin feedback (Feature 015)', () => {
  let ctx: AdminTestContext;
  let admin: Signed;
  let ids: Record<'negative' | 'positive' | 'other', string>;
  let answerId: string;
  const base = '/api/v1/admin/feedback';

  beforeEach(async () => {
    ctx = await createAdminTestApp();
    await resetAdminTables(ctx.db);
    await resetOperationsData(ctx.db);
    await seedUser(ctx.db, { account: 'ops.admin', groups: ['admin'] });
    admin = await signIn(ctx.app, 'ops.admin');
    const negative = await seedConversation(ctx.db, {
      exchanges: [{ question: '本月出貨量是多少？', answer: '本月出貨 120 件。', at: new Date('2026-11-10T02:00:00Z'), feedback: { rating: 'negative', reason: 'wrong', comment: '答案錯了' } }]
    });
    const positive = await seedConversation(ctx.db, { exchanges: [{ question: '庫存？', answer: '庫存 30 件。', at: new Date('2026-11-11T02:00:00Z'), feedback: { rating: 'positive' } }] });
    const other = await seedConversation(ctx.db, {
      customerId: OTHER_TEST_CUSTOMER, exchanges: [{ question: '別的客戶', answer: '別的回答', at: new Date('2026-11-11T03:00:00Z'), feedback: { rating: 'negative' } }]
    });
    ids = { negative: negative.exchanges[0].feedbackId!, positive: positive.exchanges[0].feedbackId!, other: other.exchanges[0].feedbackId! };
    answerId = negative.exchanges[0].answerId!;
  });
  afterEach(async () => { await closeAdminTestApp(ctx); });

  const table = (body: object = {}, signed = admin) => fromSite(api(ctx.app).post(`${base}/getTable`), signed).send(body);
  const read = (id: string, signed = admin) => api(ctx.app).get(`${base}/${id}`).set('Cookie', signed.cookie);
  const idsOf = (response: { body: { data: { items: Array<{ id: string }> } } }) => response.body.data.items.map((item) => item.id);
  const viewed = () => ctx.db.userAuditEvent.findMany({ where: { eventType: 'admin_conversation_viewed' } });

  it('lists this customer\'s feedback, newest first, without conversation text (US3-1, SC-002, SC-004)', async () => {
    const { body } = await table().expect(200);
    expect(idsOf({ body })).toEqual([ids.positive, ids.negative]);
    expect(body.data.items[1]).toMatchObject({ rating: 'negative', reason: 'wrong', comment: '答案錯了', answerDecision: 'answered', messageId: answerId });
    expect(body.data.items[1].sessionId).toEqual(expect.any(String));
    expect(JSON.stringify(body)).not.toMatch(/出貨|庫存|別的/);
  });

  it('filters and searches', async () => {
    expect(idsOf(await table({ filters: { rating: ['negative'] } }))).toEqual([ids.negative]);
    expect(idsOf(await table({ filters: { hasComment: true } }))).toEqual([ids.negative]);
    expect(idsOf(await table({ filters: { hasComment: false } }))).toEqual([ids.positive]);
    expect(idsOf(await table({ keyword: '錯了' }))).toEqual([ids.negative]);
    expect(idsOf(await table({ filters: { from: '2026-11-11T00:00:00Z' } }))).toEqual([ids.positive]);
    expect(idsOf(await table({ sort: { field: 'createdAt', order: 'asc' } }))).toEqual([ids.negative, ids.positive]);
    await table({ filters: { rating: ['great'] } }).expect(400);
    const { body } = await api(ctx.app).get(`${base}/getFilters`).set('Cookie', admin.cookie).expect(200);
    expect(body.data.rating).toContainEqual({ value: 'negative', label: '負面' });
  });

  it('adds the rated exchange only for Conversation:read, and audits it (US3-2, SC-002, SC-003)', async () => {
    const reader = await signInWithPermissions(ctx, 'feedback.reader', ['Feedback:read']);
    const withoutContent = await read(ids.negative, reader).expect(200);
    expect(withoutContent.body.data).toMatchObject({ id: ids.negative, rating: 'negative', conversation: null });
    expect(JSON.stringify(withoutContent.body)).not.toContain('出貨');
    expect(await viewed()).toHaveLength(0);

    const { body } = await read(ids.negative).expect(200);
    expect(body.data.conversation).toMatchObject({
      sessionStatus: 'active', question: { content: '本月出貨量是多少？' }, answer: { id: answerId, content: '本月出貨 120 件。', answerDecision: 'answered' }
    });
    const [event] = await viewed();
    expect(event).toMatchObject({ targetType: 'AssistantSession', targetId: body.data.sessionId, metadata: { via: 'feedback', messageId: answerId } });

    await read(ids.other).expect(404);
  });

  it('requires Feedback:read (SC-001)', async () => {
    const auditor = await signInWithPermissions(ctx, 'conversation.auditor', ['Conversation:read', 'ReviewItem:read']);
    await table({}, auditor).expect(403);
    await read(ids.negative, auditor).expect(403);
    await api(ctx.app).get(`${base}/getFilters`).set('Cookie', auditor.cookie).expect(403);
  });
});
