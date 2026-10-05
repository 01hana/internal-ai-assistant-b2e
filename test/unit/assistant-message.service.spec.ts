import { SendAssistantMessageInput } from '../../src/assistant/message/assistant-message.types';
import { AssistantController } from '../../src/assistant/assistant.controller';
import { IDENTITY_CONTEXT_REQUEST_PROPERTY } from '../../src/identity/identity-context.types';
import type { IdentityRequest } from '../../src/identity/identity-context.extractor';
import type { Response } from 'express';
import type { AssistantSseEventRecord } from '../../src/assistant/sse/assistant-sse.types';

describe('AssistantMessageService Phase 1 input boundary', () => {
  it('carries trusted, normalized, and transient inputs as separate contracts', () => {
    const input: SendAssistantMessageInput = {
      requestId: 'req-phase1-message',
      sessionId: 'session-001',
      message: '這張訂單目前狀態？',
      identityContext: {
        requestId: 'req-phase1-message',
        customer: { customerId: 'customer-a', integrationId: 'integration-erp' },
        organization: { organizationId: 'org-001' },
        hostApp: { hostApp: 'erp' },
        actor: { actorId: 'actor-001', roles: ['planner'], permissionScopes: ['orders:read'] },
        auth: { tokenId: 'private-token', gatewayIssuer: 'https://gateway.test.internal' }
      },
      hostIntegrationContext: {
        requestId: 'req-phase1-message',
        customerId: 'customer-a',
        integrationId: 'integration-erp',
        organizationId: 'org-001',
        hostApp: 'erp',
        actorId: 'actor-001',
        roles: ['planner'],
        permissionScopes: ['orders:read']
      },
      pageContext: { module: 'orders', entityType: 'order', entityId: 'SO-10001' },
      transientConnectorContext: { connectorContextRef: 'ccr_runtime_only' }
    };

    expect(input.pageContext).not.toHaveProperty('connectorContextRef');
    expect(input.transientConnectorContext).toEqual({ connectorContextRef: 'ccr_runtime_only' });
    expect(input.hostIntegrationContext).not.toHaveProperty('auth');
  });
});

describe('Feature 012 Backend provisional SSE transport', () => {
  it('writes two provider-driven deltas before generation completes, after Tool evidence', async () => {
    let finish!: () => void;
    const providerComplete = new Promise<void>((resolve) => { finish = resolve; });
    const writes: string[] = [];
    const response = {
      writableEnded: false,
      status: jest.fn().mockReturnThis(), setHeader: jest.fn(),
      write: jest.fn((chunk: string) => { writes.push(chunk); return true; }),
      end: jest.fn(), once: jest.fn(), off: jest.fn()
    } as unknown as Response;
    const identityContext = {
      requestId: 'req-stream-order', customer: { customerId: 'customer-a', integrationId: 'integration-erp' },
      organization: { organizationId: 'org-001' }, hostApp: { hostApp: 'erp' },
      actor: { actorId: 'actor-001', roles: [], permissionScopes: [] },
      auth: { tokenId: 'test-only', gatewayIssuer: 'https://gateway.test.internal' }
    };
    const request = { [IDENTITY_CONTEXT_REQUEST_PROPERTY]: identityContext } as unknown as IdentityRequest;
    const emit = (event: string): AssistantSseEventRecord => ({ event, payload: { eventType: event, requestId: 'req-stream-order', sessionId: 'session-001', messageId: 'message-001', sequence: writes.length + 1, data: {} } } as AssistantSseEventRecord);
    const sendMessage = jest.fn(async (input: SendAssistantMessageInput) => {
      for (const name of ['tool_call_started', 'tool_call_completed', 'evidence_attached', 'answer_delta', 'answer_delta']) await input.eventSink?.(emit(name));
      await providerComplete;
      await input.eventSink?.(emit('final'));
      return [];
    });
    const controller = new AssistantController(
      { getVisibleSession: jest.fn().mockResolvedValue({ id: 'session-001' }) } as never,
      { sendMessage, createErrorEvent: jest.fn() } as never,
      {} as never,
      { create: jest.fn(() => ({ host: {
        requestId: 'req-stream-order', customerId: 'customer-a', integrationId: 'integration-erp',
        organizationId: 'org-001', hostApp: 'erp', actorId: 'actor-001', roles: [], permissionScopes: []
      }, pageContext: undefined, transient: {} })) } as never
    );
    const ongoing = controller.postMessage(request, 'session-001', { message: 'query' }, response);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(writes.map((chunk) => /^event: ([^\n]+)/.exec(chunk)?.[1])).toEqual([
      'tool_call_started', 'tool_call_completed', 'evidence_attached', 'answer_delta', 'answer_delta'
    ]);
    expect(response.end).not.toHaveBeenCalled();
    finish();
    await ongoing;
    expect(writes.at(-1)).toContain('event: final');
  });
});
