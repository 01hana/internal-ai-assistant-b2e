import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import {
  createAuthorizedInternalIdentityHeaders,
  createUs1TestAppWithState,
  parseSseResponse,
  Us1TestState
} from '../support/us1-test-app.helper';
import { createInternalIdentityJwtFixture, TEST_BACKEND_AUDIENCE, TEST_GATEWAY_ISSUER } from '../support/internal-identity-jwt.helper';

describe('US4 deterministic document retrieval integration', () => {
  const fixture = createInternalIdentityJwtFixture();
  let app: INestApplication;
  let state: Us1TestState;

  beforeAll(async () => {
    const testApp = await createUs1TestAppWithState({
      internalIdentity: { issuer: TEST_GATEWAY_ISSUER, audience: TEST_BACKEND_AUDIENCE, jwks: fixture.jwks }
    });
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
      .set(createAuthorizedInternalIdentityHeaders(fixture, { claims: fixture.canonicalClaims.customerA, requestId: 'req-us4-retrieval-sop' }))
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
      .set(createAuthorizedInternalIdentityHeaders(fixture, { claims: fixture.canonicalClaims.customerA, requestId: 'req-us4-retrieval-field' }))
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

  it('attaches Customer-owned structured ToolCall evidence without disclosure', async () => {
    const initialRetrievalRunCount = state.retrievalRuns.length;
    const initialToolCallCount = state.toolCalls.length;

    const response = await request(app.getHttpServer())
      .post('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(createAuthorizedInternalIdentityHeaders(fixture, { claims: fixture.canonicalClaims.customerA, requestId: 'req-us4-structured-regression' }))
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
    const events = parseSseResponse(response.text);
    expect(events.map((event) => event.event)).toEqual([
      'tool_call_started',
      'tool_call_completed',
      'evidence_attached',
      'answer_delta',
      'final'
    ]);
    expect(events.map((event) => event.event)).not.toContain('error');

    const toolCall = state.toolCalls.at(-1);
    const evidence = state.evidenceRefs.find((item) => item.requestId === 'req-us4-structured-regression');
    expect(state.toolCalls).toHaveLength(initialToolCallCount + 1);
    expect(toolCall).toEqual(expect.objectContaining({
      customerId: 'customer-a',
      sessionId: 'session-owned-001',
      status: 'success',
      executionStatus: 'executed'
    }));
    expect(evidence).toEqual(expect.objectContaining({
      customerId: 'customer-a',
      toolCallId: toolCall?.id,
      messageId: toolCall?.messageId
    }));
    expect(state.retrievalRuns).toHaveLength(initialRetrievalRunCount);
    expect(response.text).not.toContain('customer-b');
    expect(response.text).not.toContain('sanitizerRemoved');
  });
});
