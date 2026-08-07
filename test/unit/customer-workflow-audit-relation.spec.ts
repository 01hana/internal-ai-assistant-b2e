import { INestApplication } from '@nestjs/common';
import { AuditWriterService } from '../../src/audit/audit-writer.service';
import { createCustomerScopeFromIdentityContext } from '../../src/identity/customer-scope.factory';
import { validateVerifiedInternalIdentityClaims } from '../../src/identity/identity-context.validator';
import { INTERNAL_IDENTITY_TOKEN_VERIFIER, InternalIdentityTokenVerifier } from '../../src/identity/identity-token.types';
import { createAuthorizedInternalIdentityHeaders, createUs1TestAppWithState, Us1TestState } from '../support/us1-test-app.helper';
import { createInternalIdentityJwtFixture, TEST_BACKEND_AUDIENCE, TEST_GATEWAY_ISSUER } from '../support/internal-identity-jwt.helper';

describe('US4 customer workflow audit relation consistency expected-red', () => {
  const jwt = createInternalIdentityJwtFixture();
  let app: INestApplication;
  let state: Us1TestState;

  beforeEach(async () => ({ app, state } = await createUs1TestAppWithState({
    internalIdentity: { issuer: TEST_GATEWAY_ISSUER, audience: TEST_BACKEND_AUDIENCE, jwks: jwt.jwks }
  })));
  afterEach(async () => app?.close());

  it('writes a Customer-owned redacted workflow audit for a valid session/message/ToolCall relation', async () => {
    const auditWriter = app.get(AuditWriterService);
    const scope = await customerAScope();
    const event = await auditWriter.appendCustomerWorkflowEvent({
      customerScope: scope,
      requestId: 'req-workflow-audit-valid',
      eventType: 'approval_request_approved',
      sessionId: 'session-owned-001',
      messageId: 'message-owned-assistant-001',
      toolCallId: 'tool-call-owned-001',
      metadata: {
        authorization: 'Bearer abcdefghijklmnopqrstuvwxyz',
        secret: 'secret-value',
        credential: 'credential-value',
        nested: { rawError: new Error('raw exception') }
      }
    });

    const stored = state.auditEvents.find((item) => item.id === event.id)!;
    expect(stored).toMatchObject({
      customerId: 'customer-a',
      organizationId: 'org-shared',
      hostApp: 'erp',
      actorId: 'actor-shared',
      sessionId: 'session-owned-001',
      messageId: 'message-owned-assistant-001',
      toolCallId: 'tool-call-owned-001'
    });
    expect(stored.metadata).toMatchObject({
      authorization: '[REDACTED]',
      secret: '[REDACTED]',
      credential: '[REDACTED]'
    });
    expect(JSON.stringify(stored.metadata)).not.toMatch(/abcdefghijklmnopqrstuvwxyz|secret-value|credential-value|raw exception/i);
  });

  it.each([
    ['same-Customer ToolCall with a different session', () => {
      const toolCall = structuredClone(state.toolCalls.find((item) => item.id === 'tool-call-owned-001')!);
      toolCall.id = 'tool-call-a-wrong-session';
      toolCall.sessionId = 'session-closed-001';
      state.toolCalls.push(toolCall);
      return { toolCallId: toolCall.id };
    }],
    ['same-Customer ToolCall with a different message', () => {
      const toolCall = structuredClone(state.toolCalls.find((item) => item.id === 'tool-call-owned-001')!);
      toolCall.id = 'tool-call-a-wrong-message';
      toolCall.messageId = 'message-owned-user-001';
      state.toolCalls.push(toolCall);
      return { toolCallId: toolCall.id };
    }],
    ['same-Customer message from a different session', () => {
      const message = structuredClone(state.messages.find((item) => item.id === 'message-owned-assistant-001')!);
      message.id = 'message-a-wrong-session';
      message.sessionId = 'session-closed-001';
      state.messages.push(message);
      return { messageId: message.id };
    }],
    ['foreign ToolCall', () => ({ toolCallId: 'tool-call-hidden-001' })],
    ['foreign message', () => ({ messageId: 'message-hidden-assistant-001' })]
  ])('rejects %s without disclosing workflow context or mutating state', async (_name, arrange) => {
    const auditWriter = app.get(AuditWriterService);
    const scope = await customerAScope();
    const relation = arrange();
    const before = structuredClone({
      auditEvents: state.auditEvents,
      approvalRequests: state.approvalRequests,
      messages: state.messages,
      toolCalls: state.toolCalls
    });

    await expect(auditWriter.appendCustomerWorkflowEvent({
      customerScope: scope,
      requestId: 'req-workflow-audit-invalid',
      eventType: 'approval_request_approved',
      sessionId: 'session-owned-001',
      messageId: relation.messageId ?? 'message-owned-assistant-001',
      toolCallId: relation.toolCallId ?? 'tool-call-owned-001',
      metadata: { foreignPayload: { id: 'must-not-disclose' } }
    })).rejects.toThrow('Customer workflow audit context not found.');

    expect(state.auditEvents).toEqual(before.auditEvents);
    expect(state.approvalRequests).toEqual(before.approvalRequests);
    expect(state.messages).toEqual(before.messages);
    expect(state.toolCalls).toEqual(before.toolCalls);
  });

  async function customerAScope() {
    const authorization = createAuthorizedInternalIdentityHeaders(jwt, {
      claims: jwt.canonicalClaims.customerA
    }).authorization;
    const verifier = app.get<InternalIdentityTokenVerifier>(INTERNAL_IDENTITY_TOKEN_VERIFIER);
    const verified = await verifier.verify({ authorization });
    return createCustomerScopeFromIdentityContext({
      ...validateVerifiedInternalIdentityClaims(verified),
      requestId: 'req-workflow-audit-scope'
    });
  }
});
