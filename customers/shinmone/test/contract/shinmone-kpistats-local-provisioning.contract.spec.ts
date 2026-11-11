import { createPrismaClient } from '../../../../src/prisma/prisma-client.factory';
import { seedProductOwnedData } from '../../../../scripts/seed';
import { loadLocalKpiCatalog, runLocalKpiProvisioning } from '../../scripts/provision-shinmone-kpistats-local';

const url = process.env.ASSISTANT_ISOLATED_PG_URL;
const isolated = url && /^assistant_kpistats_[a-z0-9_]+$/.test(new URL(url).pathname.slice(1));
const describeIsolated = isolated ? describe : describe.skip;

describe('Shinmone local KPIStats provisioning catalog', () => {
  it('matches three staged ToolDefinitions to exact fixed-period operations', () => {
    expect(loadLocalKpiCatalog().map((tool) => tool.name)).toEqual([
      'shinmone.kpistats.snapshot.today',
      'shinmone.kpistats.snapshot.weekly',
      'shinmone.kpistats.snapshot.monthly'
    ]);
  });
});

describeIsolated('Shinmone local KPIStats provisioning against isolated PostgreSQL', () => {
  const db = createPrismaClient(url!);
  const customerId = 'customer-shinmone-scm-local';
  const c01 = ['work-orders.monthly-new-count', 'work-orders.today-new-count', 'work-orders.weekly-new-count'];
  const demo = ['shinmone.kpistats.snapshot.today', 'shinmone.kpistats.snapshot.weekly', 'shinmone.kpistats.snapshot.monthly'];
  const verifiedBackend = async () => ({ startedAt: new Date(Date.now() - 10_000) });

  beforeAll(async () => {
    await db.customer.create({ data: { id: customerId } });
    await db.customer.create({ data: { id: 'customer-other' } });
    await db.integrationBinding.create({ data: { integrationId: 'shinmone-scm-assistant-local',
      customerId, allowedHostApp: 'shinmone-scm', enabled: true } });
    await seedProductOwnedData(db);
    const definitions = await db.toolDefinition.findMany({ where: { name: { in: c01 } } });
    expect(definitions).toHaveLength(3);
    for (const definition of definitions) await db.customerToolPolicy.create({ data: {
      customerId, toolDefinitionId: definition.id, enabled: true,
      requiredRoles: [], requiredPermissionScopes: []
    } });
    const otherTool = await db.toolDefinition.findUniqueOrThrow({ where: {
      name_version: { name: 'inventory.stock-on-hand', version: '1.0.0' }
    } });
    await db.customerToolPolicy.create({ data: { customerId: 'customer-other', toolDefinitionId: otherTool.id,
      enabled: true, requiredRoles: [], requiredPermissionScopes: [] } });
  });
  afterAll(async () => db.$disconnect());

  it('prepares disabled policies idempotently, switches atomically, and restores C01', async () => {
    const otherBefore = await db.customerToolPolicy.findMany({ where: { customerId: 'customer-other' },
      select: { toolDefinitionId: true, enabled: true } });
    const before = await runLocalKpiProvisioning(db, 'dry-run');
    if (!('demo' in before) || !before.demo) throw new Error('DRY_RUN_RESULT_MISSING');
    expect(before.demo.every((item) => !item.registered)).toBe(true);
    await runLocalKpiProvisioning(db, 'verify-default');
    await runLocalKpiProvisioning(db, 'prepare');
    await runLocalKpiProvisioning(db, 'prepare');
    await runLocalKpiProvisioning(db, 'verify-c01');
    await runLocalKpiProvisioning(db, 'verify-default');
    expect(await db.toolDefinition.count({ where: { name: { in: demo } } })).toBe(3);
    expect(await db.customerToolPolicy.count({ where: { customerId, enabled: false,
      toolDefinition: { name: { in: demo } } } })).toBe(3);
    await runLocalKpiProvisioning(db, 'activate', verifiedBackend);
    await runLocalKpiProvisioning(db, 'verify-demo', verifiedBackend);
    expect(await db.customerToolPolicy.findMany({ where: { customerId: 'customer-other' },
      select: { toolDefinitionId: true, enabled: true } })).toEqual(otherBefore);
    expect(await db.customerToolPolicy.count({ where: { customerId, enabled: true,
      toolDefinition: { name: { in: c01 } } } })).toBe(0);
    expect(await db.customerToolPolicy.count({ where: { customerId: 'customer-other',
      toolDefinition: { name: { in: demo } } } })).toBe(0);
    await runLocalKpiProvisioning(db, 'rollback');
    await runLocalKpiProvisioning(db, 'verify-c01');
    expect(await db.customerToolPolicy.findMany({ where: { customerId: 'customer-other' },
      select: { toolDefinitionId: true, enabled: true } })).toEqual(otherBefore);
    expect(await db.toolDefinition.count({ where: { name: { in: demo } } })).toBe(3);
  });

  it('refuses activation when the Customer has another enabled Integration', async () => {
    await db.integrationBinding.create({ data: { integrationId: 'another-local-integration', customerId,
      allowedHostApp: 'other-app', enabled: true } });
    try {
      await expect(runLocalKpiProvisioning(db, 'activate', verifiedBackend)).rejects.toThrow();
      expect(await db.customerToolPolicy.count({ where: { customerId, enabled: true,
        toolDefinition: { name: { in: demo } } } })).toBe(0);
    } finally {
      await db.integrationBinding.delete({ where: { integrationId: 'another-local-integration' } });
    }
    await runLocalKpiProvisioning(db, 'verify-c01');
  });

  it('allows historical NULL Sessions while keeping them unchanged', async () => {
    const migration = await db.$queryRaw<Array<{ finishedAt: Date }>>`
      SELECT MAX(finished_at) AS "finishedAt" FROM "_prisma_migrations"
      WHERE migration_name = '20261029000000_assistant_session_integration_whitespace_check'`;
    const legacyCreatedAt = new Date(migration[0]!.finishedAt.getTime() + 1_000);
    const verifiedAfterLegacy = async () => ({ startedAt: new Date(legacyCreatedAt.getTime() + 1_000) });
    const legacy = await db.assistantSession.create({ data: {
      customerId, integrationId: null, hostApp: 'shinmone-scm', organizationId: 'synthetic-org',
      actorId: 'synthetic-actor', createdAt: legacyCreatedAt
    } });
    try {
      await runLocalKpiProvisioning(db, 'activate', verifiedAfterLegacy);
      expect((await db.assistantSession.findUniqueOrThrow({ where: { id: legacy.id } })).integrationId).toBeNull();
      await runLocalKpiProvisioning(db, 'verify-demo', verifiedAfterLegacy);
      await runLocalKpiProvisioning(db, 'rollback');
    } finally { await db.assistantSession.delete({ where: { id: legacy.id } }); }
  });

  it('blocks activation when the verified Backend creates a NULL Session', async () => {
    const unsafe = await db.assistantSession.create({ data: {
      customerId, integrationId: null, hostApp: 'shinmone-scm', organizationId: 'synthetic-org',
      actorId: 'synthetic-actor'
    } });
    try {
      await expect(runLocalKpiProvisioning(db, 'activate', verifiedBackend)).rejects.toThrow();
      expect(await db.customerToolPolicy.count({ where: { customerId, enabled: true,
        toolDefinition: { name: { in: demo } } } })).toBe(0);
    } finally { await db.assistantSession.delete({ where: { id: unsafe.id } }); }
  });

  it('blocks a new NULL Session from another Customer on the same Backend', async () => {
    const unsafe = await db.assistantSession.create({ data: {
      customerId: 'customer-other', integrationId: null, hostApp: 'other-app',
      organizationId: 'synthetic-org', actorId: 'synthetic-actor'
    } });
    try {
      await expect(runLocalKpiProvisioning(db, 'activate', verifiedBackend)).rejects.toThrow();
    } finally { await db.assistantSession.delete({ where: { id: unsafe.id } }); }
  });

  it('blocks activation when a current managed Backend cannot be verified', async () => {
    await expect(runLocalKpiProvisioning(db, 'activate', async () => {
      throw new Error('CURRENT_BACKEND_UNVERIFIED');
    })).rejects.toThrow('CURRENT_BACKEND_UNVERIFIED');
    expect(await db.customerToolPolicy.count({ where: { customerId, enabled: true,
      toolDefinition: { name: { in: demo } } } })).toBe(0);
  });
});
