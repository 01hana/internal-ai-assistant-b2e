import { createHash } from 'node:crypto';
import request = require('supertest');
import { StructuredLoggerService, type StructuredLogEntry } from '../../src/common/logger/structured-logger.service';
import {
  createAuthorizedInternalIdentityHeaders,
  createUs1TestAppWithState,
  parseSseResponse
} from '../support/us1-test-app.helper';
import { DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE } from '../support/internal-identity-jwt.helper';

const CONNECTOR_CONTEXT_REF = `ccr_${'R'.repeat(43)}`;
const SENTINELS = Object.freeze({
  nativeAccessToken: 'native-access-token-phase13-sentinel',
  refreshToken: 'refresh-token-phase13-sentinel',
  bindingProof: 'binding-proof-phase13-sentinel',
  serviceProof: 'eyJhbGciOiJSUzI1NiJ9.c2VydmljZS1wcm9vZi1zZW50aW5lbA.c2lnbmF0dXJl',
  providerPayload: 'provider-payload-phase13-sentinel',
  providerCredential: 'provider-credential-phase13-sentinel',
  apiKey: 'sk-phase13-api-key-sentinel',
  authorization: 'Bearer phase13-authorization-sentinel',
  rawUpstream: 'raw-upstream-response-phase13-sentinel',
  deniedField: 'pre-projection-denied-field-phase13-sentinel',
  acceptedEntry: 'accepted-entry-phase13-sentinel'
});

describe('Feature 009 prohibited-material leak closeout', () => {
  it('keeps the transient connector reference out of persistence, Evidence, answer, SSE, and history', async () => {
    const fixture = await createUs1TestAppWithState();
    try {
      const headers = createAuthorizedInternalIdentityHeaders(DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE, {
        claims: { permission_scopes: ['orders:read'] },
        requestId: 'req-phase13-transient-reference'
      });
      const response = await request(fixture.app.getHttpServer())
        .post('/api/v1/assistant/sessions/session-owned-001/messages')
        .set(headers)
        .send({
          message: '這張訂單目前狀態？',
          pageContext: {
            module: 'orders', screenId: 'order-detail', entityType: 'order', entityId: 'SO-10001',
            connectorContextRef: CONNECTOR_CONTEXT_REF
          }
        });
      expect(response.status).toBe(200);
      expect(parseSseResponse(response.text).map(({ event }) => event)).toEqual([
        'tool_call_started', 'tool_call_completed', 'evidence_attached', 'answer_delta', 'final'
      ]);
      const history = await request(fixture.app.getHttpServer())
        .get('/api/v1/assistant/sessions/session-owned-001/messages')
        .set({ ...headers, 'x-request-id': 'req-phase13-history-reference-scan' });
      expect(history.status).toBe(200);

      const serialized = JSON.stringify({
        response: response.text,
        history: history.body,
        sessions: fixture.state.sessions,
        messages: fixture.state.messages,
        contextStates: fixture.state.contextStates,
        toolCalls: fixture.state.toolCalls,
        evidenceRefs: fixture.state.evidenceRefs,
        auditEvents: fixture.state.auditEvents,
        queryUnderstandingResults: fixture.state.queryUnderstandingResults,
        executionPlans: fixture.state.executionPlans,
        groundingChecks: fixture.state.groundingChecks,
        answerDecisions: fixture.state.answerDecisions,
        feedbackEvents: fixture.state.feedbackEvents
      });
      expect(serialized).not.toContain(CONNECTOR_CONTEXT_REF);
    } finally {
      await fixture.app.close();
    }
  });

  it('allows only redacted representations into central structured logs', () => {
    const entries: StructuredLogEntry[] = [];
    const logger = new StructuredLoggerService((entry) => entries.push(entry));
    const consoleSpies = [
      jest.spyOn(console, 'log').mockImplementation(),
      jest.spyOn(console, 'warn').mockImplementation(),
      jest.spyOn(console, 'error').mockImplementation()
    ];
    try {
      logger.write('error', 'connector request failed', 'Phase13LeakScan', {
        nativeCredential: SENTINELS.nativeAccessToken,
        refreshToken: SENTINELS.refreshToken,
        signature: SENTINELS.bindingProof,
        serviceJwt: SENTINELS.serviceProof,
        credentialProviderPayload: {
          raw: SENTINELS.providerPayload,
          acceptedEntry: SENTINELS.acceptedEntry
        },
        providerCredential: SENTINELS.providerCredential,
        apiKey: SENTINELS.apiKey,
        authorization: SENTINELS.authorization,
        connectorOutput: SENTINELS.rawUpstream,
        foreignResult: SENTINELS.deniedField
      });
      const serialized = JSON.stringify(entries);
      for (const sentinel of Object.values(SENTINELS)) {
        for (const representation of prohibitedRepresentations(sentinel)) {
          expect(serialized).not.toContain(representation);
        }
      }
      expect(consoleSpies.every((spy) => spy.mock.calls.length === 0)).toBe(true);
    } finally {
      for (const spy of consoleSpies) spy.mockRestore();
    }
  });
});

function prohibitedRepresentations(value: string): readonly string[] {
  return Object.freeze([
    value,
    Buffer.from(value, 'utf8').toString('base64'),
    Buffer.from(value, 'utf8').toString('base64url'),
    Buffer.from(value, 'utf8').toString('hex'),
    createHash('sha256').update(value, 'utf8').digest('hex'),
    createHash('sha256').update(value, 'utf8').digest('base64url')
  ]);
}
