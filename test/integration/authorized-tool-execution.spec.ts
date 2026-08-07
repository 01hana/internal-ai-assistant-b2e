import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { createAuthorizedInternalIdentityHeaders, createUs1TestAppWithState, parseSseResponse, Us1TestState } from '../support/us1-test-app.helper';
import { DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE } from '../support/internal-identity-jwt.helper';

describe('US2 authorized mock connector tool execution', () => {
  let app: INestApplication;
  let state: Us1TestState;

  beforeAll(async () => {
    const testApp = await createUs1TestAppWithState();
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

  it('uses an authorized mock inventory connector path instead of falling back to a no-answer shell', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(
        {
          ...createAuthorizedInternalIdentityHeaders(DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE, {
            claims: { permission_scopes: ['orders:read', 'inventory:read'] },
            requestId: 'req-us2-authorized-tool'
          }),
          'x-permission-scopes': 'orders:read,inventory:read'
        }
      )
      .send({
        message: '請查 SKU-DEMO-RED 目前庫存',
        pageContext: {
          module: 'inventory',
          entityType: 'item',
          entityId: 'SKU-DEMO-RED',
          visibleColumns: ['availableQuantity', 'incomingQuantity']
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
    const finalEvent = events.find((event) => event.event === 'final');
    const completedToolEvent = events.find((event) => event.event === 'tool_call_completed');
    const latestToolCall = state.toolCalls[state.toolCalls.length - 1];

    expect(completedToolEvent?.data?.data?.status).toBe('completed');
    expect(latestToolCall?.toolName).toBe('mock.inventory.availability.lookup');
    expect(latestToolCall?.outputSummary).toEqual(
      expect.objectContaining({
        availableQuantity: 36,
        incomingQuantity: 120
      })
    );
    expect(finalEvent?.data).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          answerDecision: 'answered',
          answer: expect.stringContaining('36')
        })
      })
    );
  });
});
