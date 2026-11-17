import { readFileSync } from 'node:fs';
import { AvailableCapabilityService } from '../../src/capabilities/available-capability.service';
import { parseAssistantExperiencePayload } from '../../src/assistant-experience/assistant-experience.parser';
import { AssistantExperienceService, DEFAULT_ASSISTANT_GREETING } from '../../src/assistant-experience/assistant-experience.service';
import type { HostIntegrationContext } from '../../src/host-integration/host-integration.types';
import { createExperienceHarness, EXPERIENCE_HOST as host } from '../support/assistant-experience.fixture';

const raw = () => JSON.parse(readFileSync('test/fixtures/assistant-experience/customer-a.v1.json', 'utf8'));

describe('AssistantExperienceService (Feature 013 T019)', () => {
  async function setup(payloadInput: unknown = raw(), denyAllTools = false) {
    const h = await createExperienceHarness();
    if (denyAllTools) h.tools.resolveExactToolForCustomer.mockImplementation((async () => ({ deniedReason: 'customer_policy_denied' })) as never);
    const parsed = parseAssistantExperiencePayload(payloadInput);
    if (!parsed.ok) throw new Error('fixture invalid');
    const findActive = jest.fn(async (customerId: string, integrationId: string) =>
      customerId === parsed.payload.customerId && integrationId === parsed.payload.integrationId ? { payload: parsed.payload } : null);
    const available = new AvailableCapabilityService(h.registry, { ...h.tools, isExecutableReadOnly: () => true } as never);
    return { service: new AssistantExperienceService({ findActive } as never, available), findActive };
  }
  const ids = async (service: AssistantExperienceService, scope: HostIntegrationContext, module?: string) =>
    (await service.buildOpening(scope, module ? { module } : undefined)).quickReplies.map((item) => item.id);

  it('returns the configured greeting and visible Quick Replies ordered by priority', async () => {
    const { service } = await setup();
    const opening = await service.buildOpening(host, { module: 'dashboard' });
    expect(opening).toEqual({ configVersion: '1.0.0', greeting: '你好，我可以協助查詢工單與訂單資訊。', quickReplies: [
      { id: 'overview', label: '你能查詢哪些資料？' },
      { id: 'work-orders-today', label: '今天新增幾張工單？' },
      { id: 'work-orders-month', label: '本月新增幾張工單？' }] });
  });

  it('applies page scope only when the page module matches', async () => {
    const { service } = await setup();
    expect(await ids(service, host, 'orders')).toEqual(['overview', 'work-orders-today']);
    expect(await ids(service, host)).toEqual(['overview', 'work-orders-today']);
  });

  it('hides Quick Replies the actor cannot run and the overview when nothing is available', async () => {
    const { service } = await setup();
    expect(await ids(service, { ...host, permissionScopes: ['work-orders:read'] }, 'dashboard')).toEqual(['overview', 'work-orders-today']);
    // orders.status needs no scope, so the overview stays visible while the actor can still run something.
    expect(await ids(service, { ...host, permissionScopes: [] }, 'dashboard')).toEqual(['overview']);
    const nothingAvailable = await setup(raw(), true);
    expect(await ids(nothingAvailable.service, host, 'dashboard')).toEqual([]);
  });

  it('truncates to maxQuickReplies', async () => {
    const input = raw(); input.maxQuickReplies = 2;
    const { service } = await setup(input);
    expect(await ids(service, host, 'dashboard')).toEqual(['overview', 'work-orders-today']);
  });

  it('falls back to the Core greeting without an active configuration or for another HostApp', async () => {
    const { service } = await setup();
    const empty = { configVersion: null, greeting: DEFAULT_ASSISTANT_GREETING, quickReplies: [] };
    expect(await service.buildOpening({ ...host, integrationId: 'integration-other' })).toEqual(empty);
    expect(await service.buildOpening({ ...host, hostApp: 'other-app' })).toEqual(empty);
  });

  it('resolves a visible Quick Reply or follow-up to its declared capability and message', async () => {
    const { service } = await setup();
    expect(await service.resolveChoice(host, 'work-orders-month')).toEqual({ choiceId: 'work-orders-month', source: 'quick_reply',
      configVersion: '1.0.0', message: '本月新增多少工單？',
      declared: { kind: 'capability', capabilityKey: 'work-orders.count', parameters: { timeRange: 'this_month' } } });
    expect(await service.resolveChoice(host, 'overview')).toMatchObject({ source: 'quick_reply', declared: { kind: 'capability_overview' } });
    expect(await service.resolveChoice(host, 'follow-week')).toMatchObject({ source: 'suggestion', message: '本週新增多少工單？',
      declared: { kind: 'capability', capabilityKey: 'work-orders.count', parameters: { timeRange: 'this_week' } } });
  });

  it('does not re-check page scope on click, but always re-checks permission', async () => {
    const { service } = await setup();
    expect(await service.resolveChoice(host, 'work-orders-month')).not.toBeNull();
    const limited = { ...host, permissionScopes: ['work-orders:read'] };
    expect(await service.resolveChoice(limited, 'work-orders-month')).toBeNull();
    expect(await service.resolveChoice(limited, 'follow-month')).toBeNull();
    const nothingAvailable = await setup(raw(), true);
    expect(await nothingAvailable.service.resolveChoice(host, 'overview')).toBeNull();
  });

  it('returns null for unknown IDs and other scopes', async () => {
    const { service } = await setup();
    expect(await service.resolveChoice(host, 'not-configured')).toBeNull();
    expect(await service.resolveChoice({ ...host, customerId: 'customer-b' }, 'work-orders-today')).toBeNull();
    expect(await service.resolveChoice({ ...host, hostApp: 'other-app' }, 'work-orders-today')).toBeNull();
  });

  describe('buildFollowUps (T032)', () => {
    const today = { timeRange: 'today' };
    const ids = async (service: AssistantExperienceService, scope: HostIntegrationContext, key: string, parameters: Record<string, string>) =>
      (await service.buildFollowUps(scope, key, parameters)).map((item) => item.id);

    it('matches whenCapabilityKey and whenParameters and keeps configuration order', async () => {
      const { service } = await setup();
      expect(await ids(service, host, 'work-orders.count', today)).toEqual(['follow-week', 'follow-month']);
      expect(await ids(service, host, 'work-orders.count', { timeRange: 'this_week' })).toEqual(['follow-month']);
    });

    it('drops a follow-up that would repeat the answered request', async () => {
      const { service } = await setup();
      expect(await ids(service, host, 'work-orders.count', { timeRange: 'this_month' })).toEqual([]);
    });

    it('drops follow-ups the actor may not run', async () => {
      const { service } = await setup();
      expect(await ids(service, { ...host, permissionScopes: ['work-orders:read'] }, 'work-orders.count', today)).toEqual(['follow-week']);
    });

    it('returns nothing for another capability, another scope or no configuration', async () => {
      const { service } = await setup();
      expect(await ids(service, host, 'orders.status', { entityRef: 'SO-1' })).toEqual([]);
      expect(await ids(service, { ...host, customerId: 'customer-b' }, 'work-orders.count', today)).toEqual([]);
      expect(await ids(service, { ...host, hostApp: 'other-app' }, 'work-orders.count', today)).toEqual([]);
    });

    it('returns at most three follow-ups', async () => {
      const input = raw();
      input.followUps = ['a', 'b', 'c', 'd'].map((suffix) => ({ id: `follow-${suffix}`, whenCapabilityKey: 'work-orders.count',
        label: suffix, message: suffix, capabilityKey: 'work-orders.count', parameters: { timeRange: 'this_week' } }));
      const { service } = await setup(input);
      expect(await ids(service, host, 'work-orders.count', today)).toEqual(['follow-a', 'follow-b', 'follow-c']);
    });
  });
});
