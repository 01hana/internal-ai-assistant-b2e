import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { MockConnectorAdapter } from '../../src/connectors/mock/mock-connector.adapter';
import { AnswerDecisionService } from '../../src/assistant/answer/answer-decision.service';
import * as groundedAnswer from '../../src/assistant/runtime/grounded-answer-input.types';
import { isolateIntegrationLlm, stubGroundedIntegrationAnswer } from '../support/isolated-integration-llm.helper';
import {
  createIdentityHeaders,
  createUs1TestAppWithState,
  parseSseResponse,
  Us1TestState
} from '../support/us1-test-app.helper';

describe('authorized evidence-grounded answer integration', () => {
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

  afterEach(() => jest.restoreAllMocks());

  it('returns an answered final SSE event with traceable evidence refs for an authorized query', async () => {
    const answerDecision = app.get(AnswerDecisionService);
    const completed = jest.spyOn(answerDecision, 'completeGeneratedAnswer');
    const isolated = isolateIntegrationLlm(app);
    const stream = stubGroundedIntegrationAnswer(isolated.llm, '"status":"picking"', '訂單狀態為 picking。');
    const response = await request(app.getHttpServer())
      .post('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(createIdentityHeaders({ 'x-request-id': 'req-us1-authorized-answer' }))
      .send({
        message: '查詢訂單目前狀態 訂單號 SO-10001',
        pageContext: {
          module: 'orders',
          entityType: 'order',
          entityId: 'SO-10001',
          visibleColumns: ['status', 'customerName']
        }
      });

    expect(response.status).toBe(200);

    const events = parseSseResponse(response.text);
    const finalEvent = events.find((event) => event.event === 'final');
    const evidenceEvent = events.find((event) => event.event === 'evidence_attached');

    expect(evidenceEvent?.data).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          evidenceRefs: expect.arrayContaining([expect.any(String)])
        })
      })
    );
    expect(finalEvent?.data).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          answerDecision: 'answered'
        })
      })
    );
    const evidence = state.evidenceRefs.find((item) => item.requestId === 'req-us1-authorized-answer');
    expect(evidence).toEqual(expect.objectContaining({ sourceType: 'structured_record', sourceId: 'SO-10001',
      summary: { fields: expect.objectContaining({ status: 'picking' }) } }));
    expect(finalEvent?.data.data.evidenceRefs).toEqual([evidence?.id]);
    expect(stream).toHaveBeenCalledTimes(1);
    expect(completed).toHaveBeenCalledWith(expect.objectContaining({
      evidenceRefIds: [evidence?.id], text: expect.stringContaining('picking')
    }));
    expect(isolated.providerGenerate).not.toHaveBeenCalled();
    expect(isolated.providerStream).not.toHaveBeenCalled();
    expect(isolated.outboundFetch).not.toHaveBeenCalled();
  });

  it('keeps declared-but-denied customerCode out of projected evidence, grounded input, SSE, and public output', async () => {
    const isolated = isolateIntegrationLlm(app);
    const stream = stubGroundedIntegrationAnswer(isolated.llm, '"status":"picking"', '訂單狀態為 picking。');
    const customerCode = 'CUSTOMER_SECRET_SENTINEL';
    const adapter = app.get(MockConnectorAdapter);
    const originalExecute = adapter.execute.bind(adapter);
    const execute = jest.spyOn(adapter, 'execute').mockImplementation(async (input) => {
      const result = await originalExecute(input);
      return result.data
        ? { ...result, data: { ...result.data, customerCode } }
        : result;
    });
    const groundedInput = jest.spyOn(groundedAnswer, 'createGroundedAnswerInput');

    const response = await request(app.getHttpServer())
      .post('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(createIdentityHeaders({ 'x-request-id': 'req-customer-code-denied' }))
      .send({
        message: '查詢訂單目前狀態 訂單號 SO-10001',
        pageContext: {
          module: 'orders',
          entityType: 'order',
          entityId: 'SO-10001',
          visibleColumns: ['status', 'customerCode']
        }
      });

    expect(response.status).toBe(200);
    expect(groundedInput).toHaveBeenCalled();
    expect(JSON.stringify({
      evidenceRefs: state.evidenceRefs,
      groundedInputs: groundedInput.mock.calls,
      groundedResults: groundedInput.mock.results,
      generationInputs: stream.mock.calls,
      response: response.text
    })).not.toContain(customerCode);
    expect(JSON.stringify(state.evidenceRefs)).not.toContain('customerCode');
    expect(response.text).not.toContain('customerCode');
    const events = parseSseResponse(response.text);
    expect(events.filter((event) => event.event !== 'answer_delta').map((event) => event.event)).toEqual([
      'tool_call_started', 'tool_call_completed', 'evidence_attached', 'final'
    ]);
    expect(events.filter((event) => event.event === 'answer_delta').map((event) => event.data.data.delta).join(''))
      .toBe(events.at(-1)?.data.data.answer);
    expect(isolated.providerGenerate).not.toHaveBeenCalled();
    expect(isolated.providerStream).not.toHaveBeenCalled();
    expect(isolated.outboundFetch).not.toHaveBeenCalled();

    groundedInput.mockRestore();
    execute.mockRestore();
  });
});
