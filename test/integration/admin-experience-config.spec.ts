import { AssistantExperienceRepository } from '../../src/assistant-experience/assistant-experience.repository';
import { AssistantExperienceService } from '../../src/assistant-experience/assistant-experience.service';
import {
  ADMIN_EXPERIENCE_HOST_APP, ADMIN_EXPERIENCE_INTEGRATION, adminExperiencePackPaths, editedConfig, OTHER_EXPERIENCE_INTEGRATION,
  resetExperienceData, withFixtureTools
} from '../support/admin-experience.fixture';
import {
  ADMIN_TEST_CUSTOMER, api, type AdminTestContext, closeAdminTestApp, createAdminTestApp, describeDbBackedAdmin, fromSite,
  resetAdminTables, seedUser, type Signed, signIn, signInWithPermissions
} from '../support/admin-test-app.helper';

/** Feature 016 US1, US2 (T006–T008): viewing and saving experience configurations. */
jest.setTimeout(60_000);

describeDbBackedAdmin('admin experience config (Feature 016)', () => {
  let ctx: AdminTestContext;
  let admin: Signed;
  const base = '/api/v1/admin/experienceConfigs';
  const path = `${base}/${ADMIN_EXPERIENCE_INTEGRATION}`;

  beforeEach(async () => {
    ctx = await createAdminTestApp({ ASSISTANT_CAPABILITY_PACK_PATHS_JSON: adminExperiencePackPaths() }, withFixtureTools);
    await resetAdminTables(ctx.db);
    await resetExperienceData(ctx.db);
    await seedUser(ctx.db, { account: 'ops.admin', groups: ['admin'] });
    admin = await signIn(ctx.app, 'ops.admin');
  });
  afterEach(async () => {
    await ctx.db.assistantExperienceConfig.deleteMany({ where: { integrationId: { in: [ADMIN_EXPERIENCE_INTEGRATION, OTHER_EXPERIENCE_INTEGRATION] } } });
    await closeAdminTestApp(ctx);
  });

  const read = (url: string, signed = admin) => api(ctx.app).get(url).set('Cookie', signed.cookie);
  const save = (body: object, signed = admin) => fromSite(api(ctx.app).post(path), signed).send(body);
  const validate = (body: object, signed = admin) => fromSite(api(ctx.app).post(`${path}/validate`), signed).send(body);
  const coreService = () => new AssistantExperienceService(new AssistantExperienceRepository({ db: ctx.db } as never),
    { resolveAvailableBindings: async () => ({ bindings: [] }) } as never);
  const coreHost = { customerId: ADMIN_TEST_CUSTOMER, integrationId: ADMIN_EXPERIENCE_INTEGRATION, hostApp: ADMIN_EXPERIENCE_HOST_APP } as never;

  it('lists this customer\'s integrations and shows the default greeting before the first save (US1-1, US1-2, SC-004)', async () => {
    const { body } = await read(`${base}/getIntegrations`).expect(200);
    expect(body.data).toEqual([{ integrationId: ADMIN_EXPERIENCE_INTEGRATION, hostApps: [ADMIN_EXPERIENCE_HOST_APP], current: null }]);
    const current = await read(path).expect(200);
    expect(current.body.data).toMatchObject({ integrationId: ADMIN_EXPERIENCE_INTEGRATION, config: null, defaultGreeting: expect.any(String) });
    await read(`${base}/${OTHER_EXPERIENCE_INTEGRATION}`).expect(404);
    await read(`${base}/missing-integration`).expect(404);
  });

  it('lists the capabilities and parameters the pack declares (US1-3)', async () => {
    const { body } = await read(`${path}/catalog`).expect(200);
    expect(body.data.available).toBe(true);
    expect(body.data.capabilities).toContainEqual({ capabilityKey: 'work-orders.count', label: '工單新增數量',
      parameters: [expect.objectContaining({ name: 'timeRange', type: 'enum', values: expect.arrayContaining([expect.objectContaining({ value: 'today' })]) })] });
  });

  it('saves a first version that Core uses at once, with IDs for new items and an audit entry (US2-2, US2-4, SC-002)', async () => {
    const { body } = await save(editedConfig(null)).expect(200);
    expect(body.data).toMatchObject({ unchanged: false, config: { configVersion: '1.0.0', source: 'admin', createdBy: { account: 'ops.admin' } } });
    const [overview, today] = body.data.config.quickReplies;
    expect(overview.id).toMatch(/^qr-[a-z0-9]{6}$/);
    expect(today.id).toBe('work-orders-today');
    expect(body.data.config.followUps[0].id).toMatch(/^fu-[a-z0-9]{6}$/);

    const opening = await coreService().buildOpening(coreHost);
    expect(opening).toMatchObject({ configVersion: '1.0.0', greeting: '你好，我可以協助查詢工單。' });
    const [event] = await ctx.db.userAuditEvent.findMany({ where: { eventType: 'admin_experience_config_saved' } });
    expect(event).toMatchObject({ actorAccount: 'ops.admin', targetType: 'ExperienceConfig' });
    expect(event.metadata).toEqual({ integrationId: ADMIN_EXPERIENCE_INTEGRATION, configVersion: '1.0.0', previousVersion: null, quickReplies: 2, followUps: 1 });
    expect(JSON.stringify(event.metadata)).not.toContain('你好');
  });

  it('numbers each save after the highest version, retires the previous one and skips unchanged content (US2-2)', async () => {
    const first = (await save(editedConfig(null)).expect(200)).body.data.config;
    const kept = { ...editedConfig('1.0.0'), quickReplies: first.quickReplies, followUps: first.followUps };
    expect((await save(kept).expect(200)).body.data).toMatchObject({ unchanged: true, config: { configVersion: '1.0.0' } });
    const second = await save({ ...kept, greeting: { text: '新的問候語' } }).expect(200);
    expect(second.body.data.config).toMatchObject({ configVersion: '1.0.1', greeting: { text: '新的問候語' } });
    const rows = await ctx.db.assistantExperienceConfig.findMany({ where: { integrationId: ADMIN_EXPERIENCE_INTEGRATION }, orderBy: { configVersion: 'asc' } });
    expect(rows.map((row) => [row.configVersion, row.status])).toEqual([['1.0.0', 'retired'], ['1.0.1', 'active']]);
    expect(await ctx.db.userAuditEvent.count({ where: { eventType: 'admin_experience_config_saved' } })).toBe(2);
    expect((await read(`${base}/getIntegrations`)).body.data[0].current).toMatchObject({ configVersion: '1.0.1', source: 'admin' });
  });

  it('rejects invalid content with paths and codes, writing nothing (US2-1, US2-2, SC-003)', async () => {
    const invalid = { ...editedConfig(null), maxQuickReplies: 9, quickReplies: [
      { kind: 'capability', label: '庫存', message: '庫存', capabilityKey: 'unknown.capability', priority: 1 }
    ] };
    const checked = await validate(invalid).expect(200);
    expect(checked.body.data.valid).toBe(false);
    expect(checked.body.data.errors).toContainEqual({ path: '$.maxQuickReplies', code: expect.any(String) });
    const { body } = await save(invalid).expect(422);
    expect(body.error.code).toBe('EXPERIENCE_CONFIG_INVALID');
    expect(body.error.details.errors.length).toBeGreaterThan(0);

    const unknownCapability = await save({ ...editedConfig(null), quickReplies: [invalid.quickReplies[0]] }).expect(422);
    expect(unknownCapability.body.error.details.errors).toContainEqual({ path: '$.quickReplies[0].capabilityKey', code: 'CAPABILITY_NOT_IN_PACK' });
    expect((await validate(editedConfig(null)).expect(200)).body.data).toEqual({ valid: true, errors: [] });
    expect(await ctx.db.assistantExperienceConfig.count({ where: { integrationId: ADMIN_EXPERIENCE_INTEGRATION } })).toBe(0);
    expect(await ctx.db.userAuditEvent.count({ where: { eventType: 'admin_experience_config_saved' } })).toBe(0);
  });

  it('refuses a save started from a version that is no longer active, and lets only one of two concurrent saves win (US2-3)', async () => {
    await save(editedConfig(null)).expect(200);
    expect((await save(editedConfig(null, '過時的編輯')).expect(409)).body.error.code).toBe('EXPERIENCE_CONFIG_CHANGED');
    const results = await Promise.all([save(editedConfig('1.0.0', '甲')), save(editedConfig('1.0.0', '乙'))]);
    expect(results.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(await ctx.db.assistantExperienceConfig.count({ where: { integrationId: ADMIN_EXPERIENCE_INTEGRATION } })).toBe(2);
  });

  it('cannot read or write another customer\'s integration (SC-004)', async () => {
    await fromSite(api(ctx.app).post(`${base}/${OTHER_EXPERIENCE_INTEGRATION}`), admin).send(editedConfig(null)).expect(404);
    await read(`${base}/${OTHER_EXPERIENCE_INTEGRATION}/catalog`).expect(404);
    expect(await ctx.db.assistantExperienceConfig.count({ where: { integrationId: OTHER_EXPERIENCE_INTEGRATION } })).toBe(0);
  });

  it('requires ExperienceConfig:read to view and ExperienceConfig:update to validate and save (FR-009, SC-001)', async () => {
    const reader = await signInWithPermissions(ctx, 'config.reader', ['ExperienceConfig:read']);
    const editor = await signInWithPermissions(ctx, 'config.editor', ['ExperienceConfig:read', 'ExperienceConfig:update']);
    const legacyCreate = await signInWithPermissions(ctx, 'config.creator', ['ExperienceConfig:create']);
    const nobody = await signInWithPermissions(ctx, 'no.config', ['Stats:read']);
    for (const url of [`${base}/getIntegrations`, path, `${path}/catalog`]) {
      await read(url, reader).expect(200);
      await read(url, nobody).expect(403);
      await read(url, legacyCreate).expect(403);
    }
    await validate(editedConfig(null), reader).expect(403);
    await save(editedConfig(null), reader).expect(403);
    await save(editedConfig(null), legacyCreate).expect(403);
    await validate(editedConfig(null), editor).expect(200);
    await save(editedConfig(null), editor).expect(200);
  });

  it('hides a developer who saved from everyone but developers (Feature 014 US5-3)', async () => {
    await seedUser(ctx.db, { account: 'dev.one', groups: ['developer'] });
    const developer = await signIn(ctx.app, 'dev.one');
    await save(editedConfig(null), developer).expect(200);
    expect((await read(path)).body.data.config.createdBy).toEqual({ account: null, label: '開發工程師' });
    expect((await read(path, developer)).body.data.config.createdBy).toEqual({ account: 'dev.one', label: 'dev.one' });
  });

  it('reports the catalogue as unavailable when no pack is loaded for the integration', async () => {
    await closeAdminTestApp(ctx);
    ctx = await createAdminTestApp({ ASSISTANT_CAPABILITY_PACK_PATHS_JSON: '[]' }, withFixtureTools);
    admin = await signIn(ctx.app, 'ops.admin');
    expect((await read(`${path}/catalog`).expect(200)).body.data).toEqual({ available: false, hostApps: [ADMIN_EXPERIENCE_HOST_APP], capabilities: [] });
    expect((await save(editedConfig(null)).expect(422)).body.error.details.errors).toContainEqual({ path: '$.hostApps[0]', code: 'NO_ACTIVE_PACK' });
  });
});
