import { ConfigService } from '@nestjs/config';
import { EnvironmentVariables } from '../../src/common/config/env.validation';
import { OpenAiProvider } from '../../src/llm/openai/openai.provider';
import { LlmExecutionService } from '../../src/llm/llm-execution.service';
import { LlmToolSelectionService } from '../../src/query-understanding/llm-tool-selection.service';
import { AssistantPlanningService } from '../../src/assistant/planning/assistant-planning.service';
import { createCustomerScopeFromHostIntegrationContext } from '../../src/host-integration/host-integration-request.factory';
import { RiskLevel } from '../../src/generated/prisma/enums';
import { createFeature011DirectHarness } from '../support/feature011-direct.fixture';

const run = process.env.RUN_LIVE_LLM_TOOL_SELECTION === 'true' ? it : it.skip;

describe('isolated real-model C01 selection; no Assistant Runtime or Connector', () => {
  run('uses the real configured OpenAI model for three paraphrases', async () => {
    const key = process.env.OPENAI_API_KEY ?? '';
    const model = process.env.LLM_MODEL ?? '';
    if (!/^sk-[A-Za-z0-9_-]{20,}$/.test(key) || !model || /placeholder|example|dummy/i.test(model)) {
      throw new Error('LIVE_LLM_TEST_CONFIGURATION_MISSING');
    }
    const harness = await createFeature011DirectHarness(['customers/shinmone/capability-packs/shinmone-scm-local/1.0.0.json']);
    const descriptions: Record<string, string> = {
      'work-orders.monthly-new-count': 'Count new work orders for the current month through a configured Customer-local connector.',
      'work-orders.today-new-count': 'Count new work orders for the current server-local day.',
      'work-orders.weekly-new-count': 'Count new work orders from server-local Monday through today.'
    };
    const resolve = harness.tools.resolveExactToolForCustomer.getMockImplementation()!;
    harness.tools.resolveExactToolForCustomer.mockImplementation(async (toolKey: string, version: string, customerId: string) => {
      const found = await resolve(toolKey, version, customerId);
      return found.resolved ? { resolved: { ...found.resolved,
        tool: { ...found.resolved.tool, description: descriptions[toolKey],
          requiredPermissionScopes: ['menu:SCM_DASHBOARD:read'] } } } : found;
    });
    const config = { get: (name: string) => name === 'OPENAI_API_KEY' ? key : model } as ConfigService<EnvironmentVariables, true>;
    const provider = new OpenAiProvider(config);
    const requestInputs: unknown[] = [];
    const modelOutputs: unknown[] = [];
    const llm = new LlmExecutionService({ getSelectedProvider: () => ({
      key: provider.key, getMetadata: provider.getMetadata.bind(provider),
      generateAnswer: async (request: Parameters<OpenAiProvider['generateAnswer']>[0]) => {
        requestInputs.push(request);
        const answer = await provider.generateAnswer(request);
        let parsed: unknown;
        try { parsed = JSON.parse(answer.content); } catch { parsed = undefined; }
        modelOutputs.push({ finishReason: answer.finishReason,
          decision: typeof parsed === 'object' && parsed !== null && 'decision' in parsed ? parsed.decision : 'invalid_json',
          toolKey: typeof parsed === 'object' && parsed !== null && 'toolKey' in parsed ? parsed.toolKey : undefined,
          parameters: typeof parsed === 'object' && parsed !== null && 'parameters' in parsed ? parsed.parameters : undefined });
        return answer;
      }
    }) } as never, { recordProviderDecision: async () => undefined } as never);
    const auditEvents: unknown[] = [];
    const selector = new LlmToolSelectionService(harness.registry,
      { ...harness.tools, isExecutableReadOnly: () => true } as never, harness.binding, llm,
      { append: async (event: unknown) => { auditEvents.push(event); } } as never);
    const host = { customerId: 'customer-shinmone-scm-local', integrationId: 'shinmone-scm-assistant-local',
      hostApp: 'shinmone-scm', organizationId: 'test-org', actorId: 'test-actor', roles: [],
      permissionScopes: ['menu:SCM_DASHBOARD:read'], requestId: 'live-selection' };
    const questions = ['這個月新增多少張工單？', '本月開了幾張新工單？', '幫我統計本月新增的工單數量。'];
    const results = [];
    for (const [index, text] of questions.entries()) {
      results.push(await selector.select({ text, host, identity: {} as never,
        requestId: `live-selection-${index + 1}`, sessionId: 'isolated-selection', messageId: `question-${index + 1}` }));
      if ((modelOutputs.at(-1) as { finishReason?: string } | undefined)?.finishReason === 'error') break;
    }
    for (const request of requestInputs as Array<{ messages: Array<{ content: string }> }>) {
      expect(request.messages[0].content).toContain('inputSchema');
      expect(request.messages[0].content).toContain('canonicalParameters');
      expect(request.messages[0].content).toContain(descriptions['work-orders.monthly-new-count']);
    }
    // Print only bounded tool-selection metadata, never prompts, credentials, or model prose.
    process.stdout.write(`${JSON.stringify({ modelSelections: modelOutputs, auditReasons: auditEvents.map((event) =>
      (event as { metadata: { reason: string } }).metadata.reason) })}\n`);
    expect(results).toEqual(questions.map(() => expect.objectContaining({ outcome: 'RESOLVED',
      parameters: { timeRange: 'this_month' }, toolCandidate: expect.objectContaining({
        key: 'work-orders.monthly-new-count', version: '1.0.0', arguments: {} }) })));
    const selected = results[0];
    if (selected.outcome !== 'RESOLVED') throw new Error('MODEL_SELECTION_NOT_RESOLVED');
    const create = jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...data,
      id: 'isolated-plan', createdAt: new Date() }));
    const planning = new AssistantPlanningService({ understandAndPersist: async () => ({
      output: { taskType: 'general_lookup', sentences: [], tokens: [], phrases: [], normalizedTerms: [],
        timeRanges: [], resolvedReferences: [], entityCandidates: [], subTasks: [],
        candidateTools: [selected.toolCandidate], riskLevel: RiskLevel.low, confidence: 1,
        clarificationNeeds: [], requiredEvidence: ['identity_context', 'structured_record'],
        capabilityResolution: selected }, persisted: { id: 'isolated-query' }
    }) } as never, { db: { executionPlan: { create } } } as never,
    { append: async () => undefined } as never);
    const plan = await planning.createPlan({ customerScope: createCustomerScopeFromHostIntegrationContext(host),
      requestId: 'isolated-plan', sessionId: 'isolated-selection', messageId: 'question-1',
      text: questions[0], hostIntegrationContext: host, identityContext: {} as never });
    expect(plan.executionPlan.candidateTools).toEqual([expect.objectContaining({
      key: 'work-orders.monthly-new-count', version: '1.0.0', arguments: {},
      capabilityKey: 'work-orders.count', bindingId: 'work-orders.monthly-new-count' })]);
  }, 45_000);
});
