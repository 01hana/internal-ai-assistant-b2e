import { INestApplication } from '@nestjs/common';
import { LlmExecutionService } from '../../src/llm/llm-execution.service';
import { LlmProviderService } from '../../src/llm/llm-provider.service';

const metadata = { provider: 'openai', model: 'isolated-integration-test', fallbackUsed: false };

/** Fail fast if a synthetic HTTP test reaches the real provider. */
export function isolateIntegrationLlm(app: INestApplication) {
  const originalFetch = globalThis.fetch.bind(globalThis);
  const outboundFetch = jest.spyOn(globalThis, 'fetch').mockImplementation((resource, init) => {
    const url = new URL(typeof resource === 'string' || resource instanceof URL ? resource : resource.url);
    if (!['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
      throw new Error('EXTERNAL_TEST_FETCH_FORBIDDEN');
    }
    return originalFetch(resource, init);
  });
  const provider = app.get(LlmProviderService).getSelectedProvider();
  const providerGenerate = jest.spyOn(provider, 'generateAnswer').mockRejectedValue(new Error('EXTERNAL_LLM_REQUEST_FORBIDDEN'));
  const providerStream = jest.spyOn(provider, 'streamAnswer').mockImplementation(async function* () {
    yield await Promise.reject(new Error('EXTERNAL_LLM_REQUEST_FORBIDDEN'));
  });
  return { llm: app.get(LlmExecutionService, { strict: false }), providerGenerate, providerStream, outboundFetch };
}

/** A success requires approved evidence and the exact fact expected by the scenario. */
export function stubGroundedIntegrationAnswer(llm: LlmExecutionService, expectedFact: string, answer: string) {
  return jest.spyOn(llm, 'streamAnswer').mockImplementation(async function* (input) {
    const evidence = input.messages.filter((message) => message.role === 'tool').map((message) => message.content).join('\n');
    const citation = input.instructions?.split('allowedCitations=')[1]?.trim();
    if (!evidence.includes(expectedFact) || !citation) throw new Error('APPROVED_EVIDENCE_MISSING');
    yield { type: 'text_delta', text: `${answer} [${citation}]` };
    yield { type: 'completed', finishReason: 'stop', metadata };
  });
}

export function stubIntegrationToolDecision(llm: LlmExecutionService, toolKey: string, entityRef: string) {
  return jest.spyOn(llm, 'generateAnswer').mockImplementation(async (input) => {
    const prompt = JSON.parse(input.messages[0]?.content ?? '{}') as { question?: string; tools?: Array<{ toolKey: string; toolVersion: string }> };
    if (input.responseFormat !== 'json' || !prompt.question?.includes(entityRef) ||
      !prompt.tools?.some((tool) => tool.toolKey === toolKey && tool.toolVersion === '1.0.0')) {
      throw new Error('UNTRUSTED_TOOL_DECISION_FIXTURE');
    }
    return { content: JSON.stringify({ decision: 'select', toolKey, toolVersion: '1.0.0',
      parameters: { entityRef }, arguments: { entityId: entityRef } }), finishReason: 'stop', metadata };
  });
}
