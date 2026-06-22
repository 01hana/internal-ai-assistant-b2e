import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import {
  createIdentityHeaders,
  createUs1TestAppWithState,
  parseSseResponse,
  Us1TestState
} from '../support/us1-test-app.helper';

describe('US4 retrieval run and candidate observability', () => {
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

  it('persists retrieval run, candidates, selected document evidence, and minimized audit', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(createIdentityHeaders({ 'x-request-id': 'req-us4-retrieval-observability' }))
      .send({
        message: '根據 SOP，退貨流程怎麼處理？',
        pageContext: {
          module: 'orders',
          visibleColumns: ['status']
        }
      });

    expect(response.status).toBe(200);

    const retrievalRun = state.retrievalRuns.find((run) => run.requestId === 'req-us4-retrieval-observability');
    expect(retrievalRun).toEqual(
      expect.objectContaining({
        strategy: 'keyword',
        selectedEvidenceRefIds: expect.arrayContaining([expect.any(String)])
      })
    );
    const candidates = state.retrievalCandidates.filter((candidate) => candidate.retrievalRunId === retrievalRun?.id);
    expect(candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceType: 'document_chunk',
          chunkId: 'knowledge-chunk-sop-return-001',
          rank: 1,
          selected: true,
          score: expect.any(Number)
        })
      ])
    );

    const finalEvent = parseSseResponse(response.text).find((event) => event.event === 'final');
    const evidenceRefIds = finalEvent?.data?.data.evidenceRefs;
    expect(evidenceRefIds).toEqual(expect.arrayContaining([expect.any(String)]));
    expect(state.evidenceRefs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: evidenceRefIds[0],
          sourceType: 'document_chunk',
          sourceId: 'knowledge-chunk-sop-return-001'
        })
      ])
    );

    const retrievalAudit = state.auditEvents.find(
      (event) => event.requestId === 'req-us4-retrieval-observability' && event.eventType === 'retrieval_run_created'
    );
    const selectedAudit = state.auditEvents.find(
      (event) => event.requestId === 'req-us4-retrieval-observability' && event.eventType === 'retrieval_candidate_selected'
    );
    const serializedAudit = JSON.stringify([retrievalAudit, selectedAudit]);

    expect(retrievalAudit?.metadata).toEqual(
      expect.objectContaining({
        retrievalRunId: retrievalRun?.id,
        provider: 'deterministic-keyword',
        selectedChunkIds: expect.arrayContaining(['knowledge-chunk-sop-return-001'])
      })
    );
    expect(selectedAudit?.metadata).toEqual(
      expect.objectContaining({
        chunkId: 'knowledge-chunk-sop-return-001',
        sourceKey: 'sop-return-process',
        rank: 1
      })
    );
    expect(serializedAudit).not.toContain('退貨流程須先確認訂單狀態');
  });

  it('returns no_answer and creates review item when document retrieval has no selected chunk', async () => {
    const initialReviewItemCount = state.reviewItems.length;

    const response = await request(app.getHttpServer())
      .post('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(createIdentityHeaders({ 'x-request-id': 'req-us4-retrieval-no-result' }))
      .send({
        message: 'manual quantum flux calibration',
        pageContext: {
          module: 'orders',
          visibleColumns: ['status']
        }
      });

    expect(response.status).toBe(200);
    const finalEvent = parseSseResponse(response.text).find((event) => event.event === 'final');
    expect(finalEvent?.data?.data).toEqual(
      expect.objectContaining({
        answerDecision: 'no_answer',
        noAnswerReason: 'no_evidence',
        evidenceRefs: []
      })
    );
    expect(state.reviewItems.slice(initialReviewItemCount)).toEqual([
      expect.objectContaining({
        sourceType: 'no_answer',
        summary: expect.stringContaining('no_evidence')
      })
    ]);
  });
});
