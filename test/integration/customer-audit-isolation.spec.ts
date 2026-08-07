import { INestApplication } from '@nestjs/common';
import { AuditWriterService } from '../../src/audit/audit-writer.service';
import { createCustomerScopeFromIdentityContext } from '../../src/identity/customer-scope.factory';
import { CustomerScope } from '../../src/identity/customer-scope.types';
import { validateVerifiedInternalIdentityClaims } from '../../src/identity/identity-context.validator';
import { RequestIdentityContext } from '../../src/identity/identity-context.types';
import { INTERNAL_IDENTITY_TOKEN_VERIFIER, InternalIdentityTokenVerifier } from '../../src/identity/identity-token.types';
import {
  createAuthorizedInternalIdentityHeaders,
  createUs1TestAppWithState,
  Us1TestState
} from '../support/us1-test-app.helper';
import {
  createInternalIdentityJwtFixture,
  TEST_BACKEND_AUDIENCE,
  TEST_GATEWAY_ISSUER
} from '../support/internal-identity-jwt.helper';

describe('T066 generic AuditWriter Customer boundary', () => {
  const jwt = createInternalIdentityJwtFixture();
  let app: INestApplication;
  let state: Us1TestState;
  let prismaMock: Record<string, { create?: jest.Mock }>;

  beforeEach(async () => {
    ({ app, state, prismaMock } = await createUs1TestAppWithState({
      internalIdentity: { issuer: TEST_GATEWAY_ISSUER, audience: TEST_BACKEND_AUDIENCE, jwks: jwt.jwks }
    }));
  });
  afterEach(async () => app?.close());

  it('writes generic audit ownership exclusively from CustomerScope and redacts non-authority metadata', async () => {
    const identityContext = await verifiedIdentityContext('customerA', 'req-t066-canonical');
    const customerScope = createCustomerScopeFromIdentityContext(identityContext);

    await app.get(AuditWriterService).append({
      customerScope,
      requestId: identityContext.requestId,
      eventType: 'generic_customer_boundary_test',
      sessionId: 'session-owned-001',
      messageId: 'message-owned-assistant-001',
      toolCallId: 'tool-call-owned-001',
      evidenceRefIds: ['evidence-owned-001'],
      permissionResult: { authorization: 'Bearer raw-token', claims: { jti: 'jwt-customer-a' } },
      metadata: {
        customerId: 'customer-b',
        integrationId: 'integration-other',
        organizationId: 'org-other',
        hostApp: 'other-host',
        actorId: 'other-actor',
        secret: 'nope'
      }
    });

    const event = state.auditEvents.at(-1)!;
    expect(event).toEqual(expect.objectContaining({
      customerId: 'customer-a',
      organizationId: 'org-shared',
      hostApp: 'erp',
      actorId: 'actor-shared',
      requestId: identityContext.requestId
    }));
    const createData = prismaMock.auditEvent.create?.mock.calls.at(-1)?.[0].data;
    expect(JSON.stringify(createData)).not.toContain('raw-token');
    expect(JSON.stringify(createData)).not.toContain('nope');
  });

  it('allows Customer A and Customer B to use the same requestId independently', async () => {
    await appendFor('customerA', 'req-t066-shared');
    await appendFor('customerB', 'req-t066-shared');

    expect(state.auditEvents.filter((event) => event.requestId === 'req-t066-shared')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ customerId: 'customer-a' }),
        expect.objectContaining({ customerId: 'customer-b' })
      ])
    );
  });

  it.each([
    ['foreign session', { sessionId: 'session-hidden-001' }],
    ['foreign message', { messageId: 'message-hidden-assistant-001' }],
    ['foreign ToolCall', { toolCallId: 'tool-call-hidden-001' }],
    ['foreign EvidenceRef', { evidenceRefIds: ['evidence-hidden-001'] }]
  ])('rejects %s before create without relation disclosure', async (_name, relations) => {
    await expectAuditContextRejected(relations);
  });

  it('rejects a same-Customer message that belongs to another session', async () => {
    state.sessions.push({ ...state.sessions.find((item) => item.id === 'session-owned-001')!, id: 'session-a-other-001' });
    state.messages.push({ ...state.messages.find((item) => item.id === 'message-owned-assistant-001')!, id: 'message-a-other-session-001', sessionId: 'session-a-other-001' });
    await expectAuditContextRejected({ sessionId: 'session-owned-001', messageId: 'message-a-other-session-001' });
  });

  it('rejects a same-Customer ToolCall that belongs to another session', async () => {
    state.sessions.push({ ...state.sessions.find((item) => item.id === 'session-owned-001')!, id: 'session-a-other-001' });
    state.toolCalls.push({ ...state.toolCalls.find((item) => item.id === 'tool-call-owned-001')!, id: 'tool-call-a-other-session-001', sessionId: 'session-a-other-001' });
    await expectAuditContextRejected({ sessionId: 'session-owned-001', toolCallId: 'tool-call-a-other-session-001' });
  });

  it('rejects a same-Customer ToolCall that belongs to another message', async () => {
    state.toolCalls.push({ ...state.toolCalls.find((item) => item.id === 'tool-call-owned-001')!, id: 'tool-call-a-other-message-001', messageId: 'message-owned-user-001' });
    await expectAuditContextRejected({ messageId: 'message-owned-assistant-001', toolCallId: 'tool-call-a-other-message-001' });
  });

  it('rejects a same-Customer EvidenceRef that belongs to another message', async () => {
    state.evidenceRefs.push({ ...state.evidenceRefs.find((item) => item.id === 'evidence-owned-001')!, id: 'evidence-a-other-message-001', messageId: 'message-owned-user-001' });
    await expectAuditContextRejected({ messageId: 'message-owned-assistant-001', evidenceRefIds: ['evidence-a-other-message-001'] });
  });

  it('does not expose a generic AuditEvent read or query API', () => {
    const writer = app.get(AuditWriterService) as AuditWriterService & { findForCustomer?: unknown; listForCustomer?: unknown };
    expect(writer.findForCustomer).toBeUndefined();
    expect(writer.listForCustomer).toBeUndefined();
  });

  async function appendFor(customer: 'customerA' | 'customerB', requestId: string) {
    const identityContext = await verifiedIdentityContext(customer, requestId);
    const customerScope = createCustomerScopeFromIdentityContext(identityContext);
    return app.get(AuditWriterService).append({ customerScope, requestId, eventType: 'generic_request_trace' });
  }

  async function expectAuditContextRejected(relations: Record<string, unknown>) {
    const identityContext = await verifiedIdentityContext('customerA', 'req-t066-invalid-context');
    const customerScope = createCustomerScopeFromIdentityContext(identityContext);
    const before = { audits: state.auditEvents.length, sessions: JSON.stringify(state.sessions), messages: JSON.stringify(state.messages), tools: JSON.stringify(state.toolCalls), evidence: JSON.stringify(state.evidenceRefs) };
    const rejected = app.get(AuditWriterService).append({ customerScope, requestId: identityContext.requestId, eventType: 'generic_invalid_context', ...relations });
    await expect(rejected).rejects.toThrow('Audit context not found.');
    await rejected.catch((error: Error) => {
      expect(error.message).not.toMatch(/session-|message-|tool-call-|evidence-/);
    });
    expect(state.auditEvents).toHaveLength(before.audits);
    expect(JSON.stringify(state.sessions)).toBe(before.sessions);
    expect(JSON.stringify(state.messages)).toBe(before.messages);
    expect(JSON.stringify(state.toolCalls)).toBe(before.tools);
    expect(JSON.stringify(state.evidenceRefs)).toBe(before.evidence);
    expect(prismaMock.auditEvent.create).not.toHaveBeenCalled();
  }

  async function verifiedIdentityContext(customer: 'customerA' | 'customerB', requestId: string): Promise<RequestIdentityContext> {
    const authorization = createAuthorizedInternalIdentityHeaders(jwt, { claims: jwt.canonicalClaims[customer] }).authorization;
    const verifier = app.get<InternalIdentityTokenVerifier>(INTERNAL_IDENTITY_TOKEN_VERIFIER);
    const verified = await verifier.verify({ authorization });
    return { ...validateVerifiedInternalIdentityClaims(verified), requestId };
  }
});
