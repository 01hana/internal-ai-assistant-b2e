import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { sessionTitleFrom } from '../../src/assistant/session/assistant-session.service';
import { createInternalIdentityJwtFixture, TEST_BACKEND_AUDIENCE, TEST_GATEWAY_ISSUER } from '../support/internal-identity-jwt.helper';
import { createAuthorizedInternalIdentityHeaders, createUs1TestAppWithState, parseSseResponse, Us1TestState } from '../support/us1-test-app.helper';

/** Feature 013 US4 (T038, T039, T040, T042): session history list, titles and archive. */
describe('session history list and archive', () => {
  const fixture = createInternalIdentityJwtFixture();
  const customerA = fixture.canonicalClaims.customerA;
  const customerB = fixture.canonicalClaims.customerB;
  let app: INestApplication;
  let state: Us1TestState;
  let counter = 0;

  beforeEach(async () => {
    ({ app, state } = await createUs1TestAppWithState({
      internalIdentity: { issuer: TEST_GATEWAY_ISSUER, audience: TEST_BACKEND_AUDIENCE, jwks: fixture.jwks }
    }));
  });
  afterEach(async () => { await app.close(); });

  const headers = (claims = customerA) =>
    createAuthorizedInternalIdentityHeaders(fixture, { claims, requestId: `req-f013-list-${++counter}` });
  const createSession = async (claims = customerA) =>
    (await request(app.getHttpServer()).post('/api/v1/assistant/sessions').set(headers(claims)).send({ pageContext: { module: 'orders' } }))
      .body.data.sessionId as string;
  const say = async (sessionId: string, message: string, claims = customerA) => {
    const response = await request(app.getHttpServer()).post(`/api/v1/assistant/sessions/${sessionId}/messages`)
      .set(headers(claims)).send({ message, pageContext: { module: 'orders' } });
    expect(parseSseResponse(response.text).some((event) => event.event === 'final')).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 5));
  };
  const list = (query = '', claims = customerA) =>
    request(app.getHttpServer()).get(`/api/v1/assistant/sessions${query}`).set(headers(claims));
  const archive = (sessionId: string, claims = customerA) =>
    request(app.getHttpServer()).post(`/api/v1/assistant/sessions/${sessionId}/archive`).set(headers(claims)).send();
  const unarchive = (sessionId: string, claims = customerA) =>
    request(app.getHttpServer()).post(`/api/v1/assistant/sessions/${sessionId}/unarchive`).set(headers(claims)).send();
  const remove = (sessionId: string, claims = customerA) =>
    request(app.getHttpServer()).delete(`/api/v1/assistant/sessions/${sessionId}`).set(headers(claims)).send();
  const listedIds = async (query = '', claims = customerA) =>
    (await list(query, claims)).body.data.sessions.map((item: { sessionId: string }) => item.sessionId) as string[];

  it('lists only the actor\'s sessions that have messages, most recently used first', async () => {
    const first = await createSession();
    const second = await createSession();
    await createSession();
    await say(first, '你好');
    await say(second, '你好');
    await say(first, '謝謝');
    const response = await list();
    expect(response.status).toBe(200);
    const ids = response.body.data.sessions.map((item: { sessionId: string }) => item.sessionId);
    expect(ids.slice(0, 2)).toEqual([first, second]);
    expect(response.body.data.sessions[0]).toEqual({ sessionId: first, title: '你好',
      createdAt: expect.any(String), lastMessageAt: expect.any(String) });
  });

  it('pages without duplicates or gaps', async () => {
    const created = [await createSession(), await createSession(), await createSession()];
    for (const id of created) await say(id, '你好');
    const page1 = await list('?limit=2');
    expect(page1.body.data.sessions).toHaveLength(2);
    expect(page1.body.data.nextCursor).toEqual(expect.any(String));
    const page2 = await list(`?limit=2&cursor=${page1.body.data.nextCursor}`);
    const all = [...page1.body.data.sessions, ...page2.body.data.sessions].map((item: { sessionId: string }) => item.sessionId);
    expect(new Set(all).size).toBe(all.length);
    expect(all).toEqual(expect.arrayContaining(created));
    expect(all.slice(0, 3)).toEqual([...created].reverse());
  });

  it('rejects an invalid limit or cursor', async () => {
    expect((await list('?limit=0')).status).toBe(400);
    expect((await list('?limit=51')).status).toBe(400);
    expect((await list('?cursor=not-a-cursor!')).status).toBe(400);
  });

  it('does not write an audit event for listing', async () => {
    await say(await createSession(), '你好');
    const before = state.auditEvents.length;
    await list();
    expect(state.auditEvents.length).toBe(before);
  });

  it('sets the title once from the first user message', async () => {
    const sessionId = await createSession();
    await say(sessionId, '你好');
    await say(sessionId, '謝謝');
    expect(state.sessions.find((item) => item.id === sessionId)?.title).toBe('你好');
    expect(sessionTitleFrom('  查詢\n\n今天   新增工單  ')).toBe('查詢 今天 新增工單');
    expect([...sessionTitleFrom('字'.repeat(60))]).toHaveLength(40);
  });

  it('never lists another Customer\'s sessions (T042)', async () => {
    const own = await createSession();
    await say(own, '你好');
    const foreign = await createSession(customerB);
    await say(foreign, '你好', customerB);
    const ids = (await list()).body.data.sessions.map((item: { sessionId: string }) => item.sessionId);
    expect(ids).toContain(own);
    expect(ids).not.toContain(foreign);
  });

  describe('delete', () => {
    it('hides an active or archived session for good, audits it and keeps its data', async () => {
      const active = await createSession();
      await say(active, '你好');
      const archived = await createSession();
      await say(archived, '謝謝');
      await archive(archived);

      for (const sessionId of [active, archived]) {
        const response = await remove(sessionId);
        expect(response.status).toBe(200);
        expect(response.body.data).toEqual({ sessionId, status: 'deleted' });
        expect(state.auditEvents.filter((event) => event.sessionId === sessionId && event.eventType === 'session_deleted')).toHaveLength(1);
        expect(state.messages.some((message) => message.sessionId === sessionId)).toBe(true);
      }

      const listed = [...await listedIds(), ...await listedIds('?status=archived')];
      expect(listed).not.toContain(active);
      expect(listed).not.toContain(archived);
      for (const sessionId of [active, archived]) {
        expect((await request(app.getHttpServer()).get(`/api/v1/assistant/sessions/${sessionId}`).set(headers())).status).toBe(404);
        expect((await unarchive(sessionId)).status).toBe(404);
        expect((await archive(sessionId)).status).toBe(404);
        expect((await remove(sessionId)).status).toBe(404);
      }
    });

    it('cannot delete or unarchive another Customer\'s session', async () => {
      const foreign = await createSession(customerB);
      expect((await remove(foreign)).status).toBe(404);
      expect((await unarchive(foreign)).status).toBe(404);
      expect(state.sessions.find((item) => item.id === foreign)?.status).toBe('active');
    });
  });

  describe('archive (T040)', () => {
    it('closes the session, audits it, and removes it from the list and from further use', async () => {
      const sessionId = await createSession();
      await say(sessionId, '你好');
      const response = await archive(sessionId);
      expect(response.status).toBe(200);
      expect(response.body.data).toEqual({ sessionId, status: 'closed' });
      expect(state.auditEvents.filter((event) => event.sessionId === sessionId && event.eventType === 'session_archived')).toHaveLength(1);
      expect((await list()).body.data.sessions.map((item: { sessionId: string }) => item.sessionId)).not.toContain(sessionId);
      expect((await request(app.getHttpServer()).get(`/api/v1/assistant/sessions/${sessionId}`).set(headers())).status).toBe(404);
      expect((await request(app.getHttpServer()).post(`/api/v1/assistant/sessions/${sessionId}/messages`).set(headers())
        .send({ message: '你好', pageContext: { module: 'orders' } })).status).toBe(404);
      expect((await archive(sessionId)).status).toBe(404);
    });

    it('lists archived sessions separately and moves them back with unarchive', async () => {
      const kept = await createSession();
      await say(kept, '你好');
      const archived = await createSession();
      await say(archived, '謝謝');
      await archive(archived);

      const active = await listedIds();
      const archivedList = await listedIds('?status=archived');
      expect(active).toContain(kept);
      expect(active).not.toContain(archived);
      expect(archivedList).toContain(archived);
      expect(archivedList).not.toContain(kept);

      const response = await unarchive(archived);
      expect(response.status).toBe(200);
      expect(response.body.data).toEqual({ sessionId: archived, status: 'active' });
      expect(state.auditEvents.filter((event) => event.sessionId === archived && event.eventType === 'session_unarchived')).toHaveLength(1);
      expect(await listedIds('?status=archived')).not.toContain(archived);
      expect(await listedIds()).toEqual(expect.arrayContaining([kept, archived]));
      expect((await request(app.getHttpServer()).get(`/api/v1/assistant/sessions/${archived}`).set(headers())).status).toBe(200);
      expect((await unarchive(archived)).status).toBe(404);
    });

    it('rejects an unknown list status', async () => {
      expect((await list('?status=deleted')).status).toBe(400);
    });

    it('cannot archive another Customer\'s session (T042)', async () => {
      const foreign = await createSession(customerB);
      expect((await archive(foreign)).status).toBe(404);
      expect(state.sessions.find((item) => item.id === foreign)?.status).toBe('active');
    });
  });
});
