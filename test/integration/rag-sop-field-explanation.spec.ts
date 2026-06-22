import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import {
  createIdentityHeaders,
  createUs1TestAppWithState,
  parseSseResponse,
  Us1TestState
} from '../support/us1-test-app.helper';

describe('US4 deterministic document retrieval integration', () => {
  let app: INestApplication;
  let state: Us1TestState;

  beforeAll(async () => {
    const testApp = await createUs1TestAppWithState();
    app = testApp.app;
    state = testApp.state;
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers SOP questions from document_chunk evidence without tool execution', async () => {
    const initialToolCallCount = state.toolCalls.length;

    const response = await request(app.getHttpServer())
      .post('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(createIdentityHeaders({ 'x-request-id': 'req-us4-retrieval-sop' }))
      .send({
        message: '退貨流程 SOP 怎麼說？',
        pageContext: {
          module: 'orders',
          visibleColumns: ['status', 'customerName']
        }
      });

    expect(response.status).toBe(200);

    const events = parseSseResponse(response.text);
    const eventNames = events.map((event) => event.event);
    const finalEvent = events.find((event) => event.event === 'final');

    expect(eventNames).toEqual(['answer_delta', 'final']);
    expect(state.toolCalls).toHaveLength(initialToolCallCount);
    expect(finalEvent?.data?.data).toEqual(
      expect.objectContaining({
        answerDecision: 'answered',
        evidenceRefs: expect.arrayContaining([expect.any(String)])
      })
    );
    expect(finalEvent?.data?.data.answer).toContain('退貨流程');

    const documentEvidence = state.evidenceRefs.find((evidence) => evidence.sourceType === 'document_chunk');
    expect(documentEvidence).toEqual(
      expect.objectContaining({
        documentId: 'knowledge-document-sop-return-001',
        chunkId: 'knowledge-chunk-sop-return-001'
      })
    );
  });

  it('answers field explanation questions with document chunks', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(createIdentityHeaders({ 'x-request-id': 'req-us4-retrieval-field' }))
      .send({
        message: 'status 欄位是什麼意思？',
        pageContext: {
          module: 'orders',
          visibleColumns: ['status']
        }
      });

    expect(response.status).toBe(200);
    const finalEvent = parseSseResponse(response.text).find((event) => event.event === 'final');
    expect(finalEvent?.data?.data).toEqual(
      expect.objectContaining({
        answerDecision: 'answered',
        evidenceRefs: expect.arrayContaining([expect.any(String)])
      })
    );
    expect(finalEvent?.data?.data.answer).toContain('status 欄位');
  });

  it('keeps live structured lookup on the tool path instead of retrieval', async () => {
    const initialRetrievalRunCount = state.retrievalRuns.length;

    const response = await request(app.getHttpServer())
      .post('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(createIdentityHeaders({ 'x-request-id': 'req-us4-structured-regression' }))
      .send({
        message: '請查 SO-10001 訂單狀態',
        pageContext: {
          module: 'orders',
          entityType: 'order',
          entityId: 'SO-10001',
          visibleColumns: ['status', 'customerName']
        }
      });

    expect(response.status).toBe(200);
    const eventNames = parseSseResponse(response.text).map((event) => event.event);
    expect(eventNames).toContain('tool_call_started');
    expect(eventNames).toContain('tool_call_completed');
    expect(state.retrievalRuns).toHaveLength(initialRetrievalRunCount);
  });
});
