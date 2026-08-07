import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { MockConnectorAdapter } from '../../src/connectors/mock/mock-connector.adapter';
import { createAuthorizedInternalIdentityHeaders, createUs1TestAppWithState, parseSseResponse, Us1TestState } from '../support/us1-test-app.helper';
import { createInternalIdentityJwtFixture, TEST_BACKEND_AUDIENCE, TEST_GATEWAY_ISSUER } from '../support/internal-identity-jwt.helper';

describe('US2 tool permission denied before execution', () => {
  const identityFixture = createInternalIdentityJwtFixture();
  let app: INestApplication;
  let state: Us1TestState;

  beforeAll(async () => {
    const testApp = await createUs1TestAppWithState({
      internalIdentity: {
        issuer: TEST_GATEWAY_ISSUER,
        audience: TEST_BACKEND_AUDIENCE,
        jwks: identityFixture.jwks
      }
    });
    app = testApp.app;
    state = testApp.state;
    state.customerToolPolicies.push({
      customerId: 'customer-a',
      toolDefinitionId: 'tool-definition-inventory-001',
      enabled: true,
      requiredRoles: [],
      requiredPermissionScopes: []
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('fails closed before tool execution, keeps unauthorized data out of downstream payloads, and audits the denial', async () => {
    const initialToolCallCount = state.toolCalls.length;
    const initialAuditCount = state.auditEvents.length;
    const connector = app.get(MockConnectorAdapter);
    const executeSpy = jest.spyOn(connector, 'execute');

    const response = await request(app.getHttpServer())
      .post('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(
        {
          ...createAuthorizedInternalIdentityHeaders(identityFixture, {
            claims: identityFixture.canonicalClaims.customerA,
            requestId: 'req-us2-tool-denied'
          }),
          'x-customer-id': 'customer-b',
          'x-permission-scopes': 'inventory:read'
        }
      )
      .send({
        message: '請查 SKU-DEMO-RED 目前庫存',
        pageContext: {
          module: 'inventory',
          entityType: 'item',
          entityId: 'SKU-DEMO-RED',
          visibleColumns: ['availableQuantity', 'incomingQuantity', 'allocatedQuantity']
        }
      });

    expect(response.status).toBe(200);

    const events = parseSseResponse(response.text);
    const eventNames = events.map((event) => event.event);
    const finalEvent = events.find((event) => event.event === 'final');
    const newAuditEvents = state.auditEvents.slice(initialAuditCount);
    const latestAssistantMessage = state.messages[state.messages.length - 1];
    const newToolCalls = state.toolCalls.slice(initialToolCallCount);

    expect(eventNames).toEqual(['tool_call_blocked', 'answer_delta', 'final']);
    expect(eventNames).not.toContain('tool_call_completed');
    expect(eventNames).not.toContain('evidence_attached');
    expect(events.find((event) => event.event === 'tool_call_blocked')?.data?.data).toEqual(
      expect.objectContaining({
        toolName: 'mock.inventory.availability.lookup',
        status: 'blocked',
        executionStatus: 'not_started',
        deniedReason: 'missing_scope'
      })
    );
    expect(newToolCalls).toEqual([
      expect.objectContaining({
        customerId: 'customer-a',
        messageId: latestAssistantMessage.id,
        toolName: 'mock.inventory.availability.lookup',
        status: 'blocked',
        executionStatus: 'not_started',
        errorCode: 'missing_scope',
        outputSummary: {}
      })
    ]);
    expect(state.evidenceRefs).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolCallId: newToolCalls[0]?.id
        })
      ])
    );
    expect(newAuditEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          customerId: 'customer-a',
          eventType: 'tool_permission_denied',
          metadata: expect.objectContaining({
            deniedReason: 'missing_scope'
          })
        })
      ])
    );
    const answerDecision = state.answerDecisions.at(-1);
    const reviewItem = state.reviewItems.at(-1);
    expect(answerDecision).toEqual(expect.objectContaining({ customerId: 'customer-a', status: 'permission_denied' }));
    expect(reviewItem).toEqual(expect.objectContaining({ customerId: 'customer-a', sourceType: 'permission_mapping_issue', sourceId: answerDecision?.id }));
    expect(newAuditEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventType: 'review_item_created', customerId: 'customer-a' }),
      expect.objectContaining({ eventType: 'answer_generated', customerId: 'customer-a' })
    ]));
    expect(executeSpy).not.toHaveBeenCalled();
    expect(JSON.stringify(finalEvent?.data)).not.toContain('availableQuantity');
    expect(JSON.stringify(finalEvent?.data)).not.toContain('incomingQuantity');
    expect(JSON.stringify(finalEvent?.data)).not.toContain('allocatedQuantity');
    expect(JSON.stringify(finalEvent?.data)).not.toContain('36');
    expect(JSON.stringify(latestAssistantMessage)).not.toContain('availableQuantity');
    expect(JSON.stringify(latestAssistantMessage)).not.toContain('incomingQuantity');
    expect(JSON.stringify(latestAssistantMessage)).not.toContain('allocatedQuantity');
  });
});
