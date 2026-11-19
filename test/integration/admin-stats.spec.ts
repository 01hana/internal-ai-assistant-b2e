import { OTHER_TEST_CUSTOMER, resetOperationsData, seedConversation } from '../support/admin-operations.fixture';
import {
  api, type AdminTestContext, closeAdminTestApp, createAdminTestApp, describeDbBackedAdmin, resetAdminTables, seedUser, type Signed, signIn, signInWithPermissions
} from '../support/admin-test-app.helper';

/** Feature 015 US2 (T007, T008): statistics, split into days and weeks in ADMIN_TIME_ZONE. */
jest.setTimeout(60_000);

describeDbBackedAdmin('admin stats (Feature 015)', () => {
  let ctx: AdminTestContext | undefined;
  let admin: Signed;

  /** Taipei is UTC+8: 15:59Z is 23:59 on the same day, 16:00Z is midnight of the next day. */
  async function start(env: Record<string, string> = {}): Promise<AdminTestContext> {
    const app = await createAdminTestApp(env);
    await resetAdminTables(app.db);
    await resetOperationsData(app.db);
    await seedUser(app.db, { account: 'ops.admin', groups: ['admin'] });
    admin = await signIn(app.app, 'ops.admin');
    await seedConversation(app.db, { actorId: 'actor-1', exchanges: [{ question: 'q1', answer: 'a1', at: new Date('2026-11-01T15:59:00Z') }] });
    await seedConversation(app.db, {
      actorId: 'actor-2', exchanges: [
        { question: 'q2', answer: 'a2', decision: 'no_answer', at: new Date('2026-11-01T16:00:00Z') },
        { question: 'q3', answer: 'a3', at: new Date('2026-11-02T03:00:00Z') }
      ]
    });
    await seedConversation(app.db, { actorId: 'actor-1', status: 'deleted', exchanges: [{ question: 'q4', answer: 'a4', at: new Date('2026-11-04T01:00:00Z') }] });
    await seedConversation(app.db, { customerId: OTHER_TEST_CUSTOMER, actorId: 'actor-x', exchanges: [{ question: 'x', answer: 'x', at: new Date('2026-11-02T03:00:00Z') }] });
    return app;
  }
  afterEach(async () => { await closeAdminTestApp(ctx); ctx = undefined; });

  const summary = (query: string, signed = admin) => api(ctx!.app).get(`/api/v1/admin/stats/getSummary?${query}`).set('Cookie', signed.cookie);
  const zeroAnswers = { answered: 0, clarification_required: 0, no_answer: 0, permission_denied: 0, tool_failed: 0, approval_required: 0, confirmation_required: 0, escalation_required: 0 };

  it('counts usage and answers per local day, with empty days as 0 and deleted conversations included', async () => {
    ctx = await start();
    const { body } = await summary('from=2026-11-01&to=2026-11-04').expect(200);
    expect(body.data).toMatchObject({ from: '2026-11-01', to: '2026-11-04', granularity: 'day', timeZone: 'Asia/Taipei' });
    expect(body.data.usage).toEqual({
      total: { sessions: 3, questions: 4, actors: 2 },
      series: [
        { period: '2026-11-01', sessions: 1, questions: 1, actors: 1 },
        { period: '2026-11-02', sessions: 1, questions: 2, actors: 1 },
        { period: '2026-11-03', sessions: 0, questions: 0, actors: 0 },
        { period: '2026-11-04', sessions: 1, questions: 1, actors: 1 }
      ]
    });
    expect(body.data.answers.total).toEqual({ ...zeroAnswers, answered: 3, no_answer: 1 });
    expect(body.data.answers.series[1]).toEqual({ ...zeroAnswers, period: '2026-11-02', answered: 1, no_answer: 1 });
    expect(body.data.answers.series[2]).toEqual({ ...zeroAnswers, period: '2026-11-03' });
    expect(body.data.answers.labels.no_answer).toBe('無法回答');
  });

  it('groups by Monday-based weeks', async () => {
    ctx = await start();
    const { body } = await summary('from=2026-11-01&to=2026-11-04&granularity=week').expect(200);
    expect(body.data.usage.series).toEqual([
      { period: '2026-10-26', sessions: 1, questions: 1, actors: 1 },
      { period: '2026-11-02', sessions: 2, questions: 3, actors: 2 }
    ]);
  });

  it('follows ADMIN_TIME_ZONE', async () => {
    ctx = await start({ ADMIN_TIME_ZONE: 'UTC' });
    const { body } = await summary('from=2026-11-01&to=2026-11-01').expect(200);
    expect(body.data.usage.series).toEqual([{ period: '2026-11-01', sessions: 2, questions: 2, actors: 2 }]);
  });

  it('validates the period', async () => {
    ctx = await start();
    await summary('from=2026-11-04&to=2026-11-01').expect(400);
    await summary('from=2026-01-01&to=2027-01-02').expect(400);
    await summary('from=2026-01-01&to=2027-01-01').expect(200);
    await summary('from=2026/11/01&to=2026-11-04').expect(400);
    await summary('to=2026-11-04').expect(400);
    await summary('from=2026-11-01&to=2026-11-04&granularity=month').expect(400);
  });

  it('requires Stats:read (SC-001)', async () => {
    ctx = await start();
    const auditor = await signInWithPermissions(ctx, 'conversation.auditor', ['Conversation:read']);
    await summary('from=2026-11-01&to=2026-11-04', auditor).expect(403);
    const analyst = await signInWithPermissions(ctx, 'stats.reader', ['Stats:read']);
    await summary('from=2026-11-01&to=2026-11-04', analyst).expect(200);
  });
});
