import { readFileSync } from 'node:fs';
import { parseAssistantExperiencePayload } from '../../../../src/assistant-experience/assistant-experience.parser';
import { AssistantExperienceService } from '../../../../src/assistant-experience/assistant-experience.service';
import { AvailableCapabilityService } from '../../../../src/capabilities/available-capability.service';
import type { HostIntegrationContext } from '../../../../src/host-integration/host-integration.types';
import type { RegisteredToolDefinition } from '../../../../src/tools/tool-registry.types';
import { createFeature011DirectHarness } from '../../../../test/support/feature011-direct.fixture';

/**
 * Feature 013 T052: the Shinmone experience configuration on the production Active Pack, with a
 * synthetic actor. Opening, overview suggestions, follow-ups and choice resolution all follow the
 * actor's dashboard permission (SC-001: shown ⇔ runnable).
 */
const configPath = 'customers/shinmone/assistant-experience/1.0.0.json';
const packPath = 'customers/shinmone/capability-packs/shinmone-scm-kpistats/1.0.0.json';
const catalogPath = 'customers/shinmone/test/fixtures/shinmone-kpistats-demo-tool-catalog.json';
const DASHBOARD = 'menu:SCM_DASHBOARD:read';
const CAPABILITY = 'shinmone.dashboard.kpistats.snapshot';

type CatalogTool = Omit<RegisteredToolDefinition, 'id' | 'key' | 'active' | 'requiredPermissionScopes'> & {
  isActive: boolean; requiredPermissions: string[]
};

const host: HostIntegrationContext = Object.freeze({ customerId: 'customer-shinmone', integrationId: 'shinmone-scm-assistant',
  hostApp: 'shinmone-scm', organizationId: 'org-synthetic', actorId: 'actor-synthetic', roles: Object.freeze([]),
  permissionScopes: Object.freeze([DASHBOARD]), requestId: 'req-shinmone-experience' });

async function createService() {
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8')) as { tools: CatalogTool[] };
  // Staged catalog → provisioned state (isActive=true), as in the configuration contract test.
  const additionalTools = Object.fromEntries(catalog.tools.map(({ isActive: _staged, requiredPermissions, ...tool }) => [tool.name, {
    customerId: 'customer-shinmone',
    tool: { ...tool, id: `fixture-${tool.name}`, key: tool.name, active: true, requiredPermissionScopes: requiredPermissions }
  }]));
  const harness = await createFeature011DirectHarness([packPath], { additionalTools });
  const parsed = parseAssistantExperiencePayload(JSON.parse(readFileSync(configPath, 'utf8')));
  if (!parsed.ok) throw new Error('Shinmone experience configuration invalid');
  const findActive = async (customerId: string, integrationId: string) =>
    customerId === parsed.payload.customerId && integrationId === parsed.payload.integrationId ? { payload: parsed.payload } : null;
  const available = new AvailableCapabilityService(harness.registry, { ...harness.tools, isExecutableReadOnly: () => true } as never);
  return new AssistantExperienceService({ findActive } as never, available);
}

const ids = (items: readonly { id: string }[]) => items.map((item) => item.id);

describe('Shinmone assistant experience on the production pack (Feature 013 T052)', () => {
  let service: AssistantExperienceService;
  beforeAll(async () => { service = await createService(); });

  it('opens the dashboard with the greeting and all four Quick Replies', async () => {
    const opening = await service.buildOpening(host, { module: 'dashboard' });
    expect(opening.greeting).toBe('你好，我是 SCM 系統的 AI 助理，可以協助查詢儀表板的工單統計。');
    expect(ids(opening.quickReplies)).toEqual(['overview', 'kpistats-new-today', 'kpistats-overdue-now', 'kpistats-completed-month']);
  });

  it('offers only the overview on another page', async () => {
    expect(ids((await service.buildOpening(host, { module: 'work-orders' })).quickReplies)).toEqual(['overview']);
  });

  it('offers nothing without the dashboard permission', async () => {
    const noPermission = { ...host, permissionScopes: [] };
    expect((await service.buildOpening(noPermission, { module: 'dashboard' })).quickReplies).toEqual([]);
    expect(await service.buildCapabilityQuickReplies(noPermission)).toEqual([]);
    expect(await service.buildFollowUps(noPermission, CAPABILITY, { timeRange: 'today' })).toEqual([]);
  });

  it('suggests the dashboard questions after an overview regardless of page', async () => {
    expect(ids(await service.buildCapabilityQuickReplies(host)))
      .toEqual(['kpistats-new-today', 'kpistats-overdue-now', 'kpistats-completed-month']);
  });

  it.each([
    ['today', ['follow-today-to-week', 'follow-today-to-month']],
    ['this_week', ['follow-week-to-today', 'follow-week-to-month']],
    ['this_month', ['follow-month-to-week']]
  ])('suggests other periods after answering %s', async (timeRange, expected) => {
    expect(ids(await service.buildFollowUps(host, CAPABILITY, { timeRange }))).toEqual(expected);
  });

  it('resolves every shown choice and refuses every choice when nothing is shown (SC-001)', async () => {
    const shown = [...ids((await service.buildOpening(host, { module: 'dashboard' })).quickReplies),
      ...ids(await service.buildFollowUps(host, CAPABILITY, { timeRange: 'today' }))];
    for (const choiceId of shown) expect(await service.resolveChoice(host, choiceId)).not.toBeNull();
    const noPermission = { ...host, permissionScopes: [] };
    for (const choiceId of shown) expect(await service.resolveChoice(noPermission, choiceId)).toBeNull();
  });
});
