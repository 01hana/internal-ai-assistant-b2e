import { AvailableCapabilityService } from '../../src/capabilities/available-capability.service';
import type { HostIntegrationContext } from '../../src/host-integration/host-integration.types';
import { LlmToolSelectionService } from '../../src/query-understanding/llm-tool-selection.service';
import { createExperienceHarness, EXPERIENCE_HOST as host } from '../support/assistant-experience.fixture';

/**
 * Feature 013 T008: the tools offered to the model must be exactly the bindings that
 * AvailableCapabilityService reports, for every permission and scope variation.
 */
describe('LLM tool offers equal AvailableCapabilityService bindings', () => {
  const variations: readonly [string, Partial<HostIntegrationContext>][] = [
    ['full permissions', {}],
    ['without monthly permission', { permissionScopes: ['work-orders:read'] }],
    ['without any permission', { permissionScopes: [] }],
    ['another integration', { integrationId: 'integration-other' }],
    ['another Customer', { customerId: 'customer-b' }]
  ];

  it.each(variations)('%s', async (_label, override) => {
    const harness = await createExperienceHarness();
    const tools = { ...harness.tools, isExecutableReadOnly: () => true };
    const generateAnswer = jest.fn(async (_prompt: { messages: { content: string }[] }) =>
      ({ content: JSON.stringify({ decision: 'none' }), finishReason: 'stop',
        metadata: { provider: 'stub', model: 'stub', fallbackUsed: false } }));
    const selection = new LlmToolSelectionService(harness.registry, tools as never, harness.binding,
      { generateAnswer } as never, { append: jest.fn(async () => undefined) } as never);
    const available = new AvailableCapabilityService(harness.registry, tools as never);
    const scope = { ...host, ...override };

    await selection.select({ text: '查詢資料', requestId: 'r', sessionId: 's', messageId: 'm', host: scope, identity: {} as never });
    const offered = generateAnswer.mock.calls.length === 0 ? [] :
      (JSON.parse(generateAnswer.mock.calls[0][0].messages[0].content).tools as { capabilityKey: string; bindingId: string }[])
        .map((tool) => `${tool.capabilityKey}#${tool.bindingId}`).sort();
    const expected = (await available.listAvailable(scope))
      .flatMap((item) => item.bindingIds.map((bindingId) => `${item.capabilityKey}#${bindingId}`)).sort();

    expect(offered).toEqual(expected);
  });
});
