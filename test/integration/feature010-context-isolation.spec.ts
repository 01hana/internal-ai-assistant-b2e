import { INestApplication } from '@nestjs/common';
import { AssistantSessionStatus } from '../../src/generated/prisma/enums';
import { ConversationContextLoaderService } from '../../src/assistant/conversation/conversation-context-loader.service';
import { createUs1TestAppWithState, Us1TestState } from '../support/us1-test-app.helper';

const ACTIVE_SCOPE = Object.freeze({
  customerId: 'customer-a',
  sessionId: 'session-owned-001',
  organizationId: 'org-shared',
  hostApp: 'erp',
  actorId: 'actor-shared'
});

describe('Feature 010 active conversation-context isolation (T019)', () => {
  let app: INestApplication;
  let state: Us1TestState;
  let loader: ConversationContextLoaderService;

  beforeAll(async () => {
    ({ app, state } = await createUs1TestAppWithState());
    loader = app.get(ConversationContextLoaderService);
    state.answerDecisions.push({
      id: 'answer-decision-context-owned-001',
      customerId: 'customer-a',
      requestId: 'req-history-seed-001',
      messageId: 'message-owned-assistant-001',
      status: 'answered',
      noAnswerReason: null,
      clarificationQuestionId: null,
      groundingCheckId: null,
      metadata: null,
      createdAt: new Date('2026-06-16T00:00:05.000Z')
    });
  });

  afterAll(async () => app.close());

  it('loads only completed exchanges and EvidenceRefs from the exact active scope', async () => {
    const result = await loader.load({ scope: ACTIVE_SCOPE });

    expect(result.chronologicalExchangeIds).toContain('req-history-seed-001');
    expect(JSON.stringify(result)).not.toMatch(/customer-b|hidden|private/i);
    expect(result.evidenceRefs.every((item) => item.id !== 'evidence-hidden-001')).toBe(true);
  });

  it.each([
    ['customerId', 'customer-missing'],
    ['sessionId', 'session-hidden-001'],
    ['organizationId', 'org-missing'],
    ['hostApp', 'wms'],
    ['actorId', 'actor-missing']
  ] as const)('fails closed for a colliding or mismatched %s', async (field, value) => {
    const result = await loader.load({ scope: { ...ACTIVE_SCOPE, [field]: value } });
    expect(result.exchanges).toEqual([]);
    expect(result.evidenceRefs).toEqual([]);
  });

  it('rejects a closed session without falling back to its messages or evidence', async () => {
    const session = state.sessions.find((item) => item.id === ACTIVE_SCOPE.sessionId && item.customerId === ACTIVE_SCOPE.customerId)!;
    const original = session.status;
    session.status = AssistantSessionStatus.closed;
    try {
      const result = await loader.load({ scope: ACTIVE_SCOPE });
      expect(result.exchanges).toEqual([]);
      expect(result.evidenceRefs).toEqual([]);
    } finally {
      session.status = original;
    }
  });

  it('keeps colliding session and request identifiers separated by Customer', async () => {
    const original = state.sessions.find((item) => item.id === ACTIVE_SCOPE.sessionId && item.customerId === ACTIVE_SCOPE.customerId)!;
    state.sessions.push({ ...original, customerId: 'customer-b' });
    const foreignMessages = state.messages
      .filter((item) => item.customerId === 'customer-b')
      .map((item) => ({ ...item, sessionId: ACTIVE_SCOPE.sessionId, requestId: 'req-history-seed-001' }));
    state.messages.push(...foreignMessages);

    const result = await loader.load({ scope: ACTIVE_SCOPE });
    expect(result.exchanges).toHaveLength(1);
    expect(JSON.stringify(result)).not.toMatch(/Customer B|private/i);
  });
});
