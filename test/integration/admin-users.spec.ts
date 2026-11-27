import {
  api, type AdminTestContext, closeAdminTestApp, createAdminTestApp, describeDbBackedAdmin, fromSite, INTERNAL_USER_FIELDS,
  resetAdminTables, seedUser, type Signed, signIn
} from '../support/admin-test-app.helper';

/** Feature 014 US4 (T019, T021): users API against the test database. */
jest.setTimeout(60_000);

describeDbBackedAdmin('admin users (Feature 014)', () => {
  let ctx: AdminTestContext;
  const base = '/api/v1/admin/users';
  let developer: Signed;
  let admin: Signed;
  let ids: Record<string, string>;

  beforeEach(async () => {
    ctx = await createAdminTestApp();
    await resetAdminTables(ctx.db);
    const support = await ctx.db.userGroup.create({ data: { name: '客服', permissions: ['Conversation:read'] } });
    ids = {
      developer: (await seedUser(ctx.db, { account: 'dev.one', groups: ['developer'] })).id,
      admin: (await seedUser(ctx.db, { account: 'ops.admin', groups: ['admin'] })).id,
      agent: (await seedUser(ctx.db, { account: 'agent.one', groups: ['客服'] })).id,
      support: support.id,
      adminGroup: (await groupId('admin')),
      developerGroup: (await groupId('developer'))
    };
    developer = await signIn(ctx.app, 'dev.one');
    admin = await signIn(ctx.app, 'ops.admin');
  });
  afterEach(async () => { await closeAdminTestApp(ctx); });

  async function groupId(code: string) {
    return (await ctx.db.userGroup.findUniqueOrThrow({ where: { code } })).id;
  }
  const send = (method: 'post' | 'put' | 'patch' | 'delete', path: string, signed: Signed, body: object = {}) =>
    fromSite(api(ctx.app)[method](`${base}${path}`), signed).send(body);
  const getAs = (path: string, signed: Signed) => api(ctx.app).get(`${base}${path}`).set('Cookie', signed.cookie);
  const accounts = (response: { body: { data: { items: Array<{ account: string }> } } }) => response.body.data.items.map((item) => item.account).sort();
  const events = async (eventType?: string) => ctx.db.userAuditEvent.findMany({ where: eventType ? { eventType } : {}, orderBy: { timestamp: 'asc' } });
  const signInWith = async (account: string, permissions: string[]) => {
    await ctx.db.userGroup.create({ data: { name: `${account}-group`, permissions } });
    await seedUser(ctx.db, { account, groups: [`${account}-group`] });
    return signIn(ctx.app, account);
  };
  const newUser = (overrides: object = {}) => ({ account: 'New.User', name: '新同事', email: 'New.User@Example.test', groupIds: [ids.support], ...overrides });

  describe('listing and reading (US4, SC-002, SC-007)', () => {
    it('lists everyone for developers and hides developer accounts from everyone else', async () => {
      expect(accounts(await send('post', '/getTable', developer))).toEqual(['agent.one', 'dev.one', 'ops.admin']);
      const forAdmin = await send('post', '/getTable', admin).expect(200);
      expect(accounts(forAdmin)).toEqual(['agent.one', 'ops.admin']);
      expect(forAdmin.body.data.total).toBe(2);
      await getAs(`/${ids.developer}`, admin).expect(404);
      await getAs(`/${ids.developer}`, developer).expect(200);
    });

    it('filters by group, status and keyword, and rejects unknown sort fields', async () => {
      await seedUser(ctx.db, { account: 'agent.two', groups: ['客服'], status: false, name: '小王' });
      expect(accounts(await send('post', '/getTable', admin, { filters: { groups: [ids.support] } }))).toEqual(['agent.one', 'agent.two']);
      expect(accounts(await send('post', '/getTable', admin, { filters: { status: [false] } }))).toEqual(['agent.two']);
      expect(accounts(await send('post', '/getTable', admin, { filters: { status: [true, false] } }))).toEqual(['agent.one', 'agent.two', 'ops.admin']);
      expect(accounts(await send('post', '/getTable', admin, { keyword: '小王' }))).toEqual(['agent.two']);
      const sorted = await send('post', '/getTable', admin, { sort: { field: 'account', order: 'desc' }, pageSize: 2 });
      expect(sorted.body.data.items.map((item: { account: string }) => item.account)).toEqual(['ops.admin', 'agent.two']);
      await send('post', '/getTable', admin, { sort: { field: 'passwordHash', order: 'asc' } }).expect(400);
    });

    it('puts the signed-in user first on page 1, outside the sort, and not again on later pages', async () => {
      await seedUser(ctx.db, { account: 'agent.two', groups: ['客服'] });
      const ordered = (response: { body: { data: { items: Array<{ account: string }> } } }) => response.body.data.items.map((item) => item.account);
      const ascending = { sort: { field: 'account', order: 'asc' } };
      expect(ordered(await send('post', '/getTable', admin, ascending))).toEqual(['ops.admin', 'agent.one', 'agent.two']);
      const first = await send('post', '/getTable', admin, { ...ascending, pageSize: 2 }).expect(200);
      expect([ordered(first), first.body.data.total]).toEqual([['ops.admin', 'agent.one'], 3]);
      expect(ordered(await send('post', '/getTable', admin, { ...ascending, pageSize: 2, page: 2 }))).toEqual(['agent.two']);
      // Not matching the search: not shown at all.
      expect(ordered(await send('post', '/getTable', admin, { keyword: 'agent' }))).toEqual(expect.not.arrayContaining(['ops.admin']));
    });

    it('offers group and status filters without the developer group for non-developers', async () => {
      const { body } = await getAs('/getFilters', admin).expect(200);
      expect(body.data.groups.map((group: { label: string }) => group.label)).toEqual(['最高管理者', '客服']);
      expect(body.data.status).toEqual([{ value: true, label: '啟用' }, { value: false, label: '停用' }]);
    });

    it('never returns internal fields', async () => {
      const responses = [
        await send('post', '/getTable', developer),
        await getAs(`/${ids.agent}`, admin),
        await send('post', '', admin, newUser()),
        await send('put', `/${ids.agent}`, admin, { name: '改名' })
      ];
      for (const response of responses) {
        expect(response.status).toBeLessThan(300);
        for (const field of INTERNAL_USER_FIELDS) expect(JSON.stringify(response.body)).not.toContain(field);
      }
    });
  });

  describe('create (US4-1, US4-5)', () => {
    it('creates a user without a password, mails the first-login link and records it', async () => {
      const { body } = await send('post', '', admin, newUser()).expect(201);
      expect(body.data).toMatchObject({ inviteSent: true, user: { account: 'new.user', email: 'new.user@example.test', status: true, invitationPending: true } });
      expect(body.data.user.groups.map((group: { name: string }) => group.name)).toEqual(['客服']);
      const token = ctx.mail.lastToken('new.user@example.test')!;
      await fromSite(api(ctx.app).post('/api/v1/admin/auth/verifyToken')).send({ token }).expect(200);
      const [event] = await events('admin_user_created');
      expect(event).toMatchObject({ actorUserId: ids.admin, targetId: body.data.user.id });
      expect(event.metadata).toMatchObject({ account: 'new.user', inviteSent: true });
    });

    it('keeps the user when the mail fails and reports inviteSent: false', async () => {
      ctx.mail.failing = true;
      const { body } = await send('post', '', admin, newUser()).expect(201);
      expect(body.data.inviteSent).toBe(false);
      expect(await ctx.db.user.count({ where: { account: 'new.user' } })).toBe(1);
      expect((await events('admin_user_created'))[0].metadata).toMatchObject({ inviteSent: false });
    });

    it('rejects invalid input, taken accounts and emails regardless of case, and unknown groups', async () => {
      await send('post', '', admin, newUser({ account: 'ab' })).expect(400);
      await send('post', '', admin, newUser({ account: 'has space' })).expect(400);
      await send('post', '', admin, newUser({ groupIds: [] })).expect(400);
      expect((await send('post', '', admin, newUser({ account: 'AGENT.ONE' })).expect(409)).body.error.code).toBe('ACCOUNT_TAKEN');
      expect((await send('post', '', admin, newUser({ email: 'Agent.One@example.test' })).expect(409)).body.error.code).toBe('EMAIL_TAKEN');
      await send('post', '', admin, newUser({ groupIds: ['missing-group'] })).expect(400);
      expect(await ctx.db.user.count({ where: { account: 'new.user' } })).toBe(0);
    });

    it('lets only developers assign the developer group', async () => {
      expect((await send('post', '', admin, newUser({ groupIds: [ids.developerGroup] })).expect(403)).body.error.code).toBe('DEVELOPER_GROUP_FORBIDDEN');
      await send('put', `/${ids.agent}`, admin, { groupIds: [ids.developerGroup] }).expect(403);
      await send('post', '', developer, newUser({ groupIds: [ids.developerGroup] })).expect(201);
    });
  });

  describe('update (US4-2, US4-3, US4-4)', () => {
    it('changes name and groups and records each kind of change', async () => {
      const { body } = await send('put', `/${ids.agent}`, admin, { name: '資深客服', groupIds: [ids.support, ids.adminGroup] }).expect(200);
      expect(body.data.groups.map((group: { name: string }) => group.name).sort()).toEqual(['客服', '最高管理者'].sort());
      expect((await events()).map((event) => event.eventType)).toEqual(expect.arrayContaining(['admin_user_updated', 'admin_user_groups_changed']));
      const [groupsChanged] = await events('admin_user_groups_changed');
      expect(groupsChanged.metadata).toMatchObject({ before: [{ name: '客服' }] });
    });

    it('lets the email of a pending invitation change and retires the old link', async () => {
      await send('post', '', admin, newUser()).expect(201);
      const user = await ctx.db.user.findUniqueOrThrow({ where: { account: 'new.user' } });
      const oldToken = ctx.mail.lastToken('new.user@example.test')!;
      await send('put', `/${user.id}`, admin, { email: 'fixed@example.test' }).expect(200);
      await fromSite(api(ctx.app).post('/api/v1/admin/auth/verifyToken')).send({ token: oldToken }).expect(400);
      expect(await events('admin_user_updated')).toHaveLength(1);
    });

    it('locks the email of an activated user except for developers, who also sign the user out', async () => {
      const agent = await signIn(ctx.app, 'agent.one');
      expect((await send('put', `/${ids.agent}`, admin, { email: 'elsewhere@example.test' }).expect(400)).body.error.code).toBe('EMAIL_LOCKED');
      await send('put', `/${ids.agent}`, admin, { email: 'agent.one@example.test', name: '同 email' }).expect(200);
      await send('put', `/${ids.agent}`, developer, { email: 'moved@example.test' }).expect(200);
      expect(await events('admin_user_email_changed')).toHaveLength(1);
      await api(ctx.app).get('/api/v1/admin/auth/profile').set('Cookie', agent.cookie).expect(401);
    });

    it('treats developer accounts as missing for non-developers', async () => {
      await send('put', `/${ids.developer}`, admin, { name: 'x' }).expect(404);
      await send('patch', '/batch', admin, { ids: [ids.developer], status: false }).expect(404);
      await send('post', `/${ids.developer}/resendInvite`, admin).expect(404);
      await send('delete', '', admin, { ids: [ids.developer] }).expect(404);
    });
  });

  describe('protection rules (US4-6)', () => {
    it('forbids disabling or deleting yourself and changing your own groups', async () => {
      await seedUser(ctx.db, { account: 'ops.second', groups: ['admin'] });
      await send('patch', '/batch', admin, { ids: [ids.admin], status: false }).expect(400);
      await send('delete', '', admin, { ids: [ids.admin] }).expect(400);
      const leave = await send('put', `/${ids.admin}`, admin, { groupIds: [ids.adminGroup, ids.support] }).expect(400);
      expect(leave.body.error.code).toBe('CANNOT_CHANGE_OWN_GROUPS');
      await send('put', `/${ids.admin}`, admin, { name: '改名', groupIds: [ids.adminGroup] }).expect(200);
    });

    it('never lets anyone grant more than they hold', async () => {
      const manager = await signInWith('user.manager', ['User:read', 'User:update', 'Conversation:read']);
      const managerGroup = (await ctx.db.userGroup.findUniqueOrThrow({ where: { name: 'user.manager-group' } })).id;
      const wider = (await ctx.db.userGroup.create({ data: { name: '稽核', permissions: ['AuditEvent:read'] } })).id;
      const managerId = (await ctx.db.user.findUniqueOrThrow({ where: { account: 'user.manager' } })).id;

      const escalate = await send('put', `/${managerId}`, manager, { groupIds: [managerGroup, ids.adminGroup] }).expect(400);
      expect(escalate.body.error.code).toBe('CANNOT_CHANGE_OWN_GROUPS');
      const promote = await send('put', `/${ids.agent}`, manager, { groupIds: [ids.support, ids.adminGroup] }).expect(403);
      expect(promote.body.error).toMatchObject({ code: 'GROUP_BEYOND_YOUR_PERMISSIONS', details: { ids: [ids.adminGroup] } });
      await send('put', `/${ids.agent}`, manager, { groupIds: [ids.support, wider] }).expect(403);
      // Removing a more powerful group is as much beyond the caller as adding it.
      await send('put', `/${ids.admin}`, manager, { groupIds: [ids.support] }).expect(403);
      // Groups the user keeps are not re-checked.
      await send('put', `/${ids.admin}`, manager, { name: '改名', groupIds: [ids.adminGroup] }).expect(200);
      await send('put', `/${ids.agent}`, manager, { groupIds: [managerGroup] }).expect(200);
      const agent = await ctx.db.user.findUniqueOrThrow({ where: { id: ids.agent }, include: { groups: true } });
      expect(agent.groups.map((group) => group.id)).toEqual([managerGroup]);
    });

    it('lets the last admin be disabled, moved or deleted (no minimum number of admins)', async () => {
      await send('patch', '/batch', developer, { ids: [ids.admin], status: false }).expect(200);
      await send('put', `/${ids.admin}`, developer, { groupIds: [ids.support] }).expect(200);
      await send('delete', '', developer, { ids: [ids.admin] }).expect(200);
    });

    it('rejects a whole batch when any user breaks a rule or is missing', async () => {
      const second = await seedUser(ctx.db, { account: 'ops.second', groups: ['admin'] });
      await send('patch', '/batch', admin, { ids: [ids.agent, ids.admin, second.id], status: false }).expect(400);
      const missing = await send('patch', '/batch', admin, { ids: [ids.agent, 'missing-user'], status: false }).expect(404);
      expect(missing.body.error).toMatchObject({ code: 'USER_NOT_FOUND', details: { ids: ['missing-user'] } });
      expect(await ctx.db.user.count({ where: { status: false } })).toBe(0);
      await send('delete', '', admin, { ids: [ids.agent, ids.admin, second.id] }).expect(400);
      expect(await ctx.db.user.count()).toBe(4);
    });
  });

  describe('status, invitations and deletion (US4-8, US4-9, US4-10)', () => {
    it('disables users at once and enables them again', async () => {
      const agent = await signIn(ctx.app, 'agent.one');
      expect((await send('patch', '/batch', admin, { ids: [ids.agent], status: false }).expect(200)).body.data).toEqual({ updated: 1 });
      await api(ctx.app).get('/api/v1/admin/auth/profile').set('Cookie', agent.cookie).expect(401);
      await send('patch', '/batch', admin, { ids: [ids.agent], status: true }).expect(200);
      await signIn(ctx.app, 'agent.one');
      expect((await events()).map((event) => event.eventType)).toEqual(expect.arrayContaining(['admin_user_disabled', 'admin_user_enabled']));
    });

    it('resends invitations only before the password is set', async () => {
      const pending = await seedUser(ctx.db, { account: 'pending.one', password: null });
      const first = await send('post', `/${pending.id}/resendInvite`, admin).expect(200);
      expect(first.body.data).toEqual({ inviteSent: true });
      const oldToken = ctx.mail.lastToken('pending.one@example.test')!;
      await send('post', `/${pending.id}/resendInvite`, admin).expect(200);
      await fromSite(api(ctx.app).post('/api/v1/admin/auth/verifyToken')).send({ token: oldToken }).expect(400);
      expect((await send('post', `/${ids.agent}/resendInvite`, admin).expect(400)).body.error.code).toBe('ALREADY_ACTIVATED');
      expect(await events('admin_user_invite_resent')).toHaveLength(2);
    });

    it('deletes users, keeps their audit trail and frees the account and email', async () => {
      await signIn(ctx.app, 'agent.one');
      expect((await send('delete', '', admin, { ids: [ids.agent] }).expect(200)).body.data).toEqual({ deleted: 1 });
      expect(await ctx.db.userSession.count({ where: { userId: ids.agent } })).toBe(0);
      const [deleted] = await events('admin_user_deleted');
      expect(deleted).toMatchObject({ targetId: ids.agent, metadata: expect.objectContaining({ account: 'agent.one' }) });
      expect(await ctx.db.userAuditEvent.count({ where: { targetId: ids.agent, eventType: 'admin_login_succeeded' } })).toBe(1);
      await send('post', '', admin, newUser({ account: 'agent.one', email: 'agent.one@example.test' })).expect(201);
    });
  });

  describe('permissions (SC-001, SC-008)', () => {
    it('lets a custom group do exactly what it was granted', async () => {
      const reader = await signInWith('user.reader', ['User:read']);
      await send('post', '/getTable', reader).expect(200);
      await getAs('/getFilters', reader).expect(200);
      await send('post', '', reader, newUser()).expect(403);
      await send('put', `/${ids.agent}`, reader, { name: 'x' }).expect(403);
      await send('patch', '/batch', reader, { ids: [ids.agent], status: false }).expect(403);
      await send('delete', '', reader, { ids: [ids.agent] }).expect(403);

      // Conversation:read too, or the 客服 group would be beyond them.
      const manager = await signInWith('user.manager', ['User:manage', 'Conversation:read']);
      await send('post', '', manager, newUser()).expect(201);
      await send('put', `/${ids.admin}`, manager, { groupIds: [ids.adminGroup, ids.support] }).expect(200);

      const none = await signInWith('no.users', ['Conversation:read']);
      await send('post', '/getTable', none).expect(403);
    });

    it('requires a session and CSRF token, and offers no way to set another user\'s password', async () => {
      await fromSite(api(ctx.app).post(`${base}/getTable`)).send({}).expect(401);
      await api(ctx.app).post(`${base}/getTable`).set('Origin', 'https://admin.example.test').set('Cookie', admin.cookie).send({}).expect(403);
      await send('put', `/${ids.agent}`, admin, { password: 'another long password' }).expect(400);
      await send('post', `/${ids.agent}/resetPassword`, admin).expect(404);
    });
  });
});
