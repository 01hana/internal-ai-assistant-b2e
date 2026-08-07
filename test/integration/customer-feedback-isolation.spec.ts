import { INestApplication, NotFoundException } from '@nestjs/common';
import { FeedbackEventService } from '../../src/feedback/feedback-event.service';
import { FeedbackRating } from '../../src/generated/prisma/enums';
import { createCustomerScopeFromIdentityContext } from '../../src/identity/customer-scope.factory';
import { validateVerifiedInternalIdentityClaims } from '../../src/identity/identity-context.validator';
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

describe('T064 Customer A/B FeedbackEvent isolation expected-red', () => {
  const jwt = createInternalIdentityJwtFixture();
  let app: INestApplication;
  let state: Us1TestState;
  let prismaMock: Record<string, { create?: jest.Mock; findMany?: jest.Mock }>;

  beforeEach(async () => {
    ({ app, state, prismaMock } = await createUs1TestAppWithState({
      internalIdentity: { issuer: TEST_GATEWAY_ISSUER, audience: TEST_BACKEND_AUDIENCE, jwks: jwt.jwks }
    }));
  });
  afterEach(async () => app?.close());

  it('persists immutable Customer ownership from explicit CustomerScope', async () => {
    const identityContext = await verifiedIdentityContext('customerA', 'req-t064-own-create');
    const customerScope = createCustomerScopeFromIdentityContext(identityContext);
    const before = snapshot();

    await expect(
      app.get(FeedbackEventService).submitFeedback({
        customerScope,
        requestId: identityContext.requestId,
        messageId: 'message-owned-assistant-001',
        identityContext,
        rating: FeedbackRating.positive,
        intent: 'other'
      })
    ).resolves.toEqual(expect.objectContaining({ messageId: 'message-owned-assistant-001' }));

    expect(customerScope.customerId).toBe('customer-a');
    expect(state.feedbackEvents.at(-1)).toEqual(expect.objectContaining({ customerId: 'customer-a' }));
    expect(snapshot()).toEqual({ ...before, feedback: before.feedback + 1, audits: before.audits + 1 });
  });

  it('rejects a foreign message before Feedback/Event/Audit writes and relation reads', async () => {
    const identityContext = await verifiedIdentityContext('customerA', 'req-t064-foreign-message');
    const before = snapshot();

    await expect(
      app.get(FeedbackEventService).submitFeedback({
        customerScope: createCustomerScopeFromIdentityContext(identityContext),
        requestId: identityContext.requestId,
        messageId: 'message-hidden-assistant-001',
        identityContext,
        rating: FeedbackRating.negative,
        intent: 'unsafe'
      })
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(snapshot()).toEqual(before);
    expect(prismaMock.feedbackEvent.create).not.toHaveBeenCalled();
    expect(prismaMock.toolCall.findMany).not.toHaveBeenCalled();
  });

  it('qualifies ToolCall and Evidence lookup by Customer before using a same-message foreign relation', async () => {
    state.toolCalls.push({
      ...state.toolCalls.find((item) => item.id === 'tool-call-hidden-001')!,
      id: 'tool-call-foreign-on-a-message',
      messageId: 'message-owned-assistant-001'
    });
    state.evidenceRefs.push({
      ...state.evidenceRefs.find((item) => item.id === 'evidence-hidden-001')!,
      id: 'evidence-foreign-on-a-message',
      messageId: 'message-owned-assistant-001'
    });
    const identityContext = await verifiedIdentityContext('customerA', 'req-t064-mixed-relations');

    await expect(
      app.get(FeedbackEventService).submitFeedback({
        customerScope: createCustomerScopeFromIdentityContext(identityContext),
        requestId: identityContext.requestId,
        messageId: 'message-owned-assistant-001',
        identityContext,
        rating: FeedbackRating.positive,
        intent: 'other'
      })
    ).resolves.toEqual(expect.anything());

    expect(prismaMock.toolCall.findMany).toHaveBeenCalledWith({
      where: { customerId: 'customer-a', messageId: 'message-owned-assistant-001', sessionId: 'session-owned-001' }
    });
    expect(prismaMock.evidenceRef.findMany).toHaveBeenCalledWith({
      where: { customerId: 'customer-a', messageId: { in: ['message-owned-assistant-001'] } }
    });
  });

  it('requires matching CustomerScope and verified identity before any Feedback-owned operation', async () => {
    const customerScope = createCustomerScopeFromIdentityContext(await verifiedIdentityContext('customerA', 'req-t064-scope-a'));
    const identityContext = await verifiedIdentityContext('customerB', 'req-t064-identity-b');
    const before = snapshot();

    await expect(
      app.get(FeedbackEventService).submitFeedback({
        customerScope,
        requestId: identityContext.requestId,
        messageId: 'message-owned-assistant-001',
        identityContext,
        rating: FeedbackRating.positive,
        intent: 'other'
      })
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(snapshot()).toEqual(before);
    expect(prismaMock.feedbackEvent.create).not.toHaveBeenCalled();
    expect(prismaMock.toolCall.findMany).not.toHaveBeenCalled();
    expect(prismaMock.evidenceRef.findMany).not.toHaveBeenCalled();
  });

  it('rolls back FeedbackEvent when feedback_received audit fails', async () => {
    const identityContext = await verifiedIdentityContext('customerA', 'req-t067-feedback-audit-rollback');
    state.workflowAuditFailureEventTypes.push('feedback_received');
    const before = snapshot();

    await expect(app.get(FeedbackEventService).submitFeedback({
      customerScope: createCustomerScopeFromIdentityContext(identityContext), requestId: identityContext.requestId,
      messageId: 'message-owned-assistant-001', identityContext, rating: FeedbackRating.positive, intent: 'other'
    })).rejects.toThrow('test-only workflow audit failure: feedback_received');

    expect(snapshot()).toEqual(before);
  });

  it('rolls back FeedbackEvent, ReviewItem, and both audits when review_item_created audit fails', async () => {
    const identityContext = await verifiedIdentityContext('customerA', 'req-t067-review-audit-rollback');
    state.workflowAuditFailureEventTypes.push('review_item_created');
    const before = snapshot();

    await expect(app.get(FeedbackEventService).submitFeedback({
      customerScope: createCustomerScopeFromIdentityContext(identityContext), requestId: identityContext.requestId,
      messageId: 'message-owned-assistant-001', identityContext, rating: FeedbackRating.negative, intent: 'unsafe'
    })).rejects.toThrow('test-only workflow audit failure: review_item_created');

    expect(snapshot()).toEqual(before);
  });

  function snapshot() {
    return {
      feedback: state.feedbackEvents.length,
      reviews: state.reviewItems.length,
      audits: state.auditEvents.length,
      toolCalls: state.toolCalls.length,
      evidence: state.evidenceRefs.length
    };
  }

  async function verifiedIdentityContext(customer: 'customerA' | 'customerB', requestId: string) {
    const authorization = createAuthorizedInternalIdentityHeaders(jwt, { claims: jwt.canonicalClaims[customer] }).authorization;
    const verifier = app.get<InternalIdentityTokenVerifier>(INTERNAL_IDENTITY_TOKEN_VERIFIER);
    const verified = await verifier.verify({ authorization });
    return { ...validateVerifiedInternalIdentityClaims(verified), requestId };
  }
});
