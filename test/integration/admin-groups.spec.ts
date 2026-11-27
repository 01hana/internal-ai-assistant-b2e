import {
  api, type AdminTestContext, closeAdminTestApp, createAdminTestApp, describeDbBackedAdmin, fromSite, resetAdminTables, seedUser, type Signed, signIn
} from '../support/admin-test-app.helper';

/** Feature 014 US3 (T020–T021): user groups API against the test database. */
jest.setTimeout(60_000);

describeDbBackedAdmin('admin groups (Feature 014)', () => {
  let ctx: AdminTestContext;
  const base = '/api/v1/admin/groups';
  let developer: Signed;
  let admin: Signed;

  beforeEach(async () => {
    ctx = await createAdminTestApp();
    await resetAdminTables(ctx.db);
    await seedUser(ctx.db, { account: 'dev.one', groups: ['developer'] });
    await seedUser(ctx.db, { account: 'ops.admin', groups: ['admin'] });
    developer = await signIn(ctx.app, 'dev.one');
    admin = await signIn(ctx.app, 'ops.admin');
  });
  afterEach(async () => { await closeAdminTestApp(ctx); });

  const customGroup = (name: string, permissions: string[]) => ctx.db.userGroup.create({ data: { name, permissions } });
  const signInWith = async (account: string, permissions: string[]) => {
    await customGroup(`${account}-group`, permissions);
    await seedUser(ctx.db, { account, groups: [`${account}-group`] });
    return signIn(ctx.app, account);
  };
  const table = (signed: Signed, body: object = {}) => fromSite(api(ctx.app).post(`${base}/getTable`), signed).send(body);
  const names = (response: { body: { data: { items: Array<{ name: string }> } } }) => response.body.data.items.map((item) => item.name);
  const idOf = async (code: string) => (await ctx.db.userGroup.findUniqueOrThrow({ where: { code } })).id;

  describe('listing (US3-3)', () => {
    it('shows developers every group and hides the developer group from everyone else', async () => {
      await customGroup('客服主管', ['Conversation:read']);
      expect(names(await table(developer))).toEqual(['最高管理者', '開發工程師', '客服主管']);
      const forAdmin = await table(admin);
      expect(names(forAdmin)).toEqual(['最高管理者', '客服主管']);
      expect(forAdmin.body.data.total).toBe(2);
      expect(forAdmin.body.data.items[0]).toMatchObject({ code: 'admin', isSystem: true, permissions: ['all:manage'], memberCount: 1 });
    });

    it('pages, searches and rejects unknown sort fields', async () => {
      for (const name of ['A 組', 'B 組', 'C 組']) await customGroup(name, []);
      const page = await table(admin, { page: 2, pageSize: 2, sort: { field: 'name', order: 'asc' } });
      expect(page.body.data.total).toBe(4);
      expect(names(page)).toEqual(['B 組', 'C 組']);
      expect(names(await table(admin, { keyword: 'b 組' }))).toEqual(['B 組']);
      expect((await table(admin, { sort: { field: 'permissions', order: 'asc' } })).body.error.code).toBe('INVALID_SORT_FIELD');
      expect((await table(admin, { pageSize: 101 })).status).toBe(400);
    });

    it('returns the permission catalogue and group options', async () => {
      await customGroup('客服主管', []);
      const catalogue = await api(ctx.app).get(`${base}/getPermissions`).set('Cookie', admin.cookie);
      expect(catalogue.body.data.map((entry: { subject: string }) => entry.subject)).toEqual(
        ['User', 'UserGroup', 'AuditEvent', 'Stats', 'Conversation', 'ReviewItem', 'Feedback', 'ExperienceConfig']);
      const options = await api(ctx.app).get(`${base}/getOptions`).set('Cookie', admin.cookie);
      expect(options.body.data.map((option: { label: string }) => option.label)).toEqual(['最高管理者', '客服主管']);
    });

    it('treats the developer group as missing for non-developers', async () => {
      const id = await idOf('developer');
      expect((await api(ctx.app).get(`${base}/${id}`).set('Cookie', admin.cookie)).status).toBe(404);
      expect((await api(ctx.app).get(`${base}/${id}`).set('Cookie', developer.cookie)).status).toBe(200);
      expect((await fromSite(api(ctx.app).patch(`${base}/${id}`), admin).send({ name: 'x' })).status).toBe(404);
    });
  });

  describe('create and update (US3-5, US3-6)', () => {
    it('creates a custom group with normalised permissions and records it', async () => {
      const response = await fromSite(api(ctx.app).post(base), admin)
        .send({ name: '  客服主管 ', description: '看對話', permissions: ['Feedback:read', 'Conversation:read', 'User:manage'] });
      expect(response.status).toBe(201);
      expect(response.body.data).toMatchObject({
        name: '客服主管', isSystem: false, memberCount: 0,
        permissions: ['User:read', 'User:create', 'User:update', 'User:delete', 'Conversation:read', 'Feedback:read']
      });
      const event = await ctx.db.userAuditEvent.findFirstOrThrow({ where: { eventType: 'admin_user_group_created' } });
      expect(event).toMatchObject({ actorAccount: 'ops.admin', targetType: 'UserGroup', targetId: response.body.data.id });
    });

    it.each([
      ['all:manage', ['all:manage'], 'INVALID_PERMISSIONS'],
      ['an unknown permission', ['Conversation:readContent'], 'INVALID_PERMISSIONS'],
      ['a blank name', [], 'BAD_REQUEST']
    ])('rejects %s', async (_label, permissions, code) => {
      const name = code === 'BAD_REQUEST' ? '   ' : '新群組';
      const response = await fromSite(api(ctx.app).post(base), admin).send({ name, permissions });
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe(code);
    });

    it('rejects a duplicate name', async () => {
      await customGroup('客服主管', []);
      const response = await fromSite(api(ctx.app).post(base), admin).send({ name: '客服主管', permissions: [] });
      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('GROUP_NAME_TAKEN');
    });

    it('updates a custom group and records before and after', async () => {
      const group = await customGroup('客服主管', ['Feedback:read']);
      const response = await fromSite(api(ctx.app).patch(`${base}/${group.id}`), admin).send({ permissions: ['Conversation:read'] });
      expect(response.status).toBe(200);
      expect(response.body.data.permissions).toEqual(['Conversation:read']);
      const event = await ctx.db.userAuditEvent.findFirstOrThrow({ where: { eventType: 'admin_user_group_updated' } });
      expect(event.metadata).toMatchObject({ before: { permissions: ['Feedback:read'] }, after: { permissions: ['Conversation:read'] } });
    });

    it('keeps built-in groups locked, even for developers', async () => {
      const response = await fromSite(api(ctx.app).patch(`${base}/${await idOf('admin')}`), developer).send({ name: '老闆' });
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('SYSTEM_GROUP_LOCKED');
    });
  });

  describe('delete (US3-6, US3-7)', () => {
    it('deletes empty custom groups and records each', async () => {
      const [a, b] = [await customGroup('A 組', []), await customGroup('B 組', [])];
      const response = await fromSite(api(ctx.app).delete(base), admin).send({ ids: [a.id, b.id] });
      expect(response.status).toBe(200);
      expect(response.body.data).toEqual({ deleted: 2 });
      expect(await ctx.db.userGroup.count({ where: { isSystem: false } })).toBe(0);
      expect(await ctx.db.userAuditEvent.count({ where: { eventType: 'admin_user_group_deleted' } })).toBe(2);
    });

    it('deletes nothing when any group is built-in, has members or is unknown', async () => {
      const empty = await customGroup('A 組', []);
      const used = await customGroup('B 組', []);
      await seedUser(ctx.db, { account: 'member', groups: ['B 組'] });

      const cases: Array<[string[], number, string]> = [
        [[empty.id, await idOf('admin')], 400, 'SYSTEM_GROUP_LOCKED'],
        [[empty.id, used.id], 400, 'GROUP_HAS_MEMBERS'],
        [[empty.id, 'missing-id'], 404, 'GROUP_NOT_FOUND'],
        [[empty.id, await idOf('developer')], 404, 'GROUP_NOT_FOUND']
      ];
      for (const [ids, status, code] of cases) {
        const response = await fromSite(api(ctx.app).delete(base), admin).send({ ids });
        expect([response.status, response.body.error.code]).toEqual([status, code]);
      }
      expect(await ctx.db.userGroup.count({ where: { id: empty.id } })).toBe(1);
    });
  });

  describe('permissions (SC-001)', () => {
    it('lets a custom group do exactly what it was granted', async () => {
      const reader = await signInWith('group.reader', ['UserGroup:read']);
      const target = await customGroup('A 組', []);
      expect((await table(reader)).status).toBe(200);
      expect((await api(ctx.app).get(`${base}/${target.id}`).set('Cookie', reader.cookie)).status).toBe(200);
      expect((await fromSite(api(ctx.app).post(base), reader).send({ name: 'x', permissions: [] })).status).toBe(403);
      expect((await fromSite(api(ctx.app).patch(`${base}/${target.id}`), reader).send({ name: 'y' })).status).toBe(403);
      expect((await fromSite(api(ctx.app).delete(base), reader).send({ ids: [target.id] })).status).toBe(403);
    });

    it('denies a group without UserGroup permissions, but gives user managers the group options', async () => {
      const none = await signInWith('no.groups', ['Feedback:read']);
      for (const response of [
        await table(none),
        await api(ctx.app).get(`${base}/getPermissions`).set('Cookie', none.cookie),
        await api(ctx.app).get(`${base}/getOptions`).set('Cookie', none.cookie)
      ]) expect(response.status).toBe(403);

      const userManager = await signInWith('user.manager', ['User:read', 'User:update']);
      const options = await api(ctx.app).get(`${base}/getOptions`).set('Cookie', userManager.cookie);
      expect(options.status).toBe(200);
      expect(options.body.data.map((option: { label: string }) => option.label)).toEqual(['最高管理者', 'no.groups-group', 'user.manager-group']);
    });

    it('never lets anyone grant more than they hold or edit their own group', async () => {
      const manager = await signInWith('group.manager', ['UserGroup:read', 'UserGroup:create', 'UserGroup:update', 'UserGroup:delete', 'User:read']);
      const own = (await ctx.db.userGroup.findUniqueOrThrow({ where: { name: 'group.manager-group' } })).id;
      const narrow = await customGroup('窄', ['User:read']);
      const wide = await customGroup('寬', ['User:read', 'User:delete']);
      const create = (signed: Signed, permissions: string[]) => fromSite(api(ctx.app).post(base), signed).send({ name: `新-${permissions.length}`, permissions });
      const patch = (id: string, body: object) => fromSite(api(ctx.app).patch(`${base}/${id}`), manager).send(body);

      expect((await create(manager, ['User:read', 'User:delete'])).body.error.code).toBe('PERMISSIONS_BEYOND_YOUR_OWN');
      expect((await create(manager, ['User:read'])).status).toBe(201);
      expect((await patch(narrow.id, { permissions: ['User:read', 'User:delete'] })).status).toBe(403);
      expect((await patch(narrow.id, { name: '窄 2', permissions: [] })).status).toBe(200);
      expect((await patch(own, { name: 'x' })).body.error.code).toBe('CANNOT_EDIT_OWN_GROUP');
      expect((await patch(wide.id, { name: 'x' })).body.error.code).toBe('GROUP_BEYOND_YOUR_PERMISSIONS');
      expect((await fromSite(api(ctx.app).delete(base), manager).send({ ids: [wide.id] })).status).toBe(403);
      expect((await fromSite(api(ctx.app).delete(base), admin).send({ ids: [wide.id] })).status).toBe(200);

      const manageable = Object.fromEntries((await table(manager)).body.data.items.map((item: { name: string; manageable: boolean }) => [item.name, item.manageable]));
      expect(manageable).toEqual({ '最高管理者': false, 'group.manager-group': false, '窄 2': true, '新-1': true });
      const options = await api(ctx.app).get(`${base}/getOptions`).set('Cookie', manager.cookie);
      expect(Object.fromEntries(options.body.data.map((option: { label: string; assignable: boolean }) => [option.label, option.assignable])))
        .toEqual({ '最高管理者': false, 'group.manager-group': true, '窄 2': true, '新-1': true });
    });

    it('lets holders of all:manage assign the admin group', async () => {
      const options = await api(ctx.app).get(`${base}/getOptions`).set('Cookie', admin.cookie);
      expect(options.body.data.every((option: { assignable: boolean }) => option.assignable)).toBe(true);
    });

    it('requires a session', async () => {
      expect((await fromSite(api(ctx.app).post(`${base}/getTable`)).send({})).status).toBe(401);
    });
  });
});
