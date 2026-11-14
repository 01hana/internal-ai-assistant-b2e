import { INestApplication } from '@nestjs/common';
import { createHash } from 'crypto';
import request = require('supertest');
import { toPageContextPersistence } from '../../src/assistant/page-context/page-context.mapper';
import { PageContextNormalizerService } from '../../src/host-integration/page-context-normalizer.service';
import { StructuredLoggerService } from '../../src/common/logger/structured-logger.service';
import { LlmExecutionService } from '../../src/llm/llm-execution.service';
import { LlmInputSanitizerService } from '../../src/permissions/llm-input-sanitizer.service';
import * as observabilityMetadata from '../../src/observability/observability-metadata.helper';
import { isolateIntegrationLlm, stubGroundedIntegrationAnswer } from '../support/isolated-integration-llm.helper';
import {
  createIdentityHeaders,
  createUs1TestAppWithState,
  parseSseResponse,
  Us1TestState
} from '../support/us1-test-app.helper';

describe('Feature 008 transient ingress boundary', () => {
  it('separates the opaque reference before any persistable PageContext is produced', () => {
    const result = new PageContextNormalizerService().splitAndNormalize({
      connectorContextRef: 'ccr_PHASE1_ONLY',
      module: 'orders',
      selectedRows: [{ id: 'SO-10001', data: { label: 'Order 10001', rawRecord: { secret: 'native-secret' } } }],
      userVisibleState: { token: 'native-secret', nested: { raw: true } }
    });

    expect(result.transient).toEqual({ connectorContextRef: 'ccr_PHASE1_ONLY' });
    const persisted = toPageContextPersistence(result.pageContext);
    expect(JSON.stringify(persisted)).not.toContain('ccr_PHASE1_ONLY');
    expect(JSON.stringify(persisted)).not.toContain('native-secret');
    expect(JSON.stringify(persisted)).not.toContain('rawRecord');
  });

  describe('prohibited downstream surfaces', () => {
    let app: INestApplication;
    let state: Us1TestState;
    let previousMode: string | undefined;

    beforeAll(async () => {
      previousMode = process.env.ASSISTANT_LLM_TOOL_SELECTION_ENABLED;
      process.env.ASSISTANT_LLM_TOOL_SELECTION_ENABLED = 'false';
      ({ app, state } = await createUs1TestAppWithState());
    });

    afterAll(async () => {
      try { await app.close(); }
      finally {
        if (previousMode === undefined) delete process.env.ASSISTANT_LLM_TOOL_SELECTION_ENABLED;
        else process.env.ASSISTANT_LLM_TOOL_SELECTION_ENABLED = previousMode;
      }
    });

    it('keeps reference, native credentials, and raw Browser records out of persistence, audit, evidence, ToolCall, SSE, and public output', async () => {
      const reference = 'ccr_TRANSIENT_SENTINEL_8f4c3a91';
      const nativeCredential = 'sk-native-credential-sentinel-9e3c5a771234';
      const rawRecord = 'RAW_BROWSER_RECORD_SENTINEL_6dcb024f';
      const isolated = isolateIntegrationLlm(app);
      const stream = stubGroundedIntegrationAnswer(isolated.llm, '"status":"picking"', '訂單狀態為 picking。');
      const structuredLogWrite = jest.spyOn(StructuredLoggerService.prototype, 'write');
      const observabilityInput = jest.spyOn(observabilityMetadata, 'createRuntimeDecisionMetadata');
      const modelInputSanitizer = jest.spyOn(app.get(LlmInputSanitizerService), 'sanitize');
      const llmExecution = app.get(LlmExecutionService);
      const generateAnswer = jest.spyOn(llmExecution, 'generateAnswer');
      const classifyIntent = jest.spyOn(llmExecution, 'classifyIntent');
      const summarize = jest.spyOn(llmExecution, 'summarize');
      const response = await request(app.getHttpServer())
        .post('/api/v1/assistant/sessions/session-owned-001/messages')
        .set(createIdentityHeaders({ 'x-request-id': 'req-feature008-transient' }))
        .send({
          message: '查詢訂單目前狀態 訂單號 SO-10001',
          pageContext: {
            connectorContextRef: reference,
            module: 'orders',
            entityType: 'order',
            entityId: 'SO-10001',
            selectedRows: [{
              id: 'SO-10001',
              data: { label: 'Order 10001', credential: nativeCredential, rawRecord: { value: rawRecord } }
            }],
            userVisibleState: { token: nativeCredential, rawPayload: { value: rawRecord } }
          }
        });

      expect(response.status).toBe(200);
      const events = parseSseResponse(response.text);
      expect(events.filter((event) => event.event !== 'answer_delta').map((event) => event.event)).toEqual([
        'tool_call_started', 'tool_call_completed', 'evidence_attached', 'final'
      ]);
      expect(events.filter((event) => event.event === 'answer_delta').map((event) => event.data.data.delta).join(''))
        .toBe(events.at(-1)?.data.data.answer);
      expect(state.toolCalls.at(-1)).toEqual(expect.objectContaining({ status: 'success' }));
      expect(state.evidenceRefs.at(-1)).toEqual(expect.objectContaining({ sourceId: 'SO-10001' }));
      const persistedAndPublic = JSON.stringify({
        messages: state.messages,
        contextStates: state.contextStates,
        queryUnderstandingResults: state.queryUnderstandingResults,
        executionPlans: state.executionPlans,
        toolCalls: state.toolCalls,
        evidenceRefs: state.evidenceRefs,
        auditEvents: state.auditEvents,
        sseBuilds: state.orchestration.sseEventBuilds.mock.calls,
        generationInputs: stream.mock.calls,
        responseText: response.text,
        responseBody: response.body
      });

      for (const sentinel of [reference, nativeCredential, rawRecord]) {
        expect(persistedAndPublic).not.toContain(sentinel);
        expect(persistedAndPublic).not.toContain(Buffer.from(sentinel).toString('base64'));
        expect(persistedAndPublic).not.toContain(createHash('sha256').update(sentinel).digest('hex'));
      }
      expect(persistedAndPublic).not.toContain('TRANSIENT_SENTINEL_8f4c3a91');
      expect(persistedAndPublic).not.toContain('RAW_BROWSER_RECORD_SENTINEL_6dcb024f');

      expect(structuredLogWrite).not.toHaveBeenCalled();
      expect(observabilityInput).toHaveBeenCalled();
      for (const [metadata] of observabilityInput.mock.calls) {
        expect(metadata).toEqual({ durationMs: expect.any(Number) });
      }
      const observabilityCapture = JSON.stringify(observabilityInput.mock.calls);
      const modelPreparationCapture = JSON.stringify({
        calls: modelInputSanitizer.mock.calls,
        results: modelInputSanitizer.mock.results.map((result) => result.value)
      });
      for (const sentinel of [reference, nativeCredential, rawRecord]) {
        expect(observabilityCapture).not.toContain(sentinel);
        expect(modelPreparationCapture).not.toContain(sentinel);
      }
      expect(modelInputSanitizer).toHaveBeenCalled();
      expect(generateAnswer).not.toHaveBeenCalled();
      expect(stream).toHaveBeenCalledTimes(1);
      expect(isolated.providerGenerate).not.toHaveBeenCalled();
      expect(isolated.providerStream).not.toHaveBeenCalled();
      expect(isolated.outboundFetch).not.toHaveBeenCalled();
      expect(classifyIntent).not.toHaveBeenCalled();
      expect(summarize).not.toHaveBeenCalled();

      structuredLogWrite.mockRestore();
      observabilityInput.mockRestore();
      modelInputSanitizer.mockRestore();
      generateAnswer.mockRestore();
      classifyIntent.mockRestore();
      summarize.mockRestore();
      jest.restoreAllMocks();
    });
  });
});
