import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { ToolOperation } from '../../src/generated/prisma/enums';
import { createAuthorizedInternalIdentityHeaders, createUs1TestAppWithState, Us1TestState } from '../support/us1-test-app.helper';
import { createInternalIdentityJwtFixture, TEST_BACKEND_AUDIENCE, TEST_GATEWAY_ISSUER } from '../support/internal-identity-jwt.helper';

describe('US3 side-effect execution guard', () => {
  const jwt = createInternalIdentityJwtFixture();
  let app: INestApplication;
  let state: Us1TestState;

  beforeEach(async () => {
    const testApp = await createUs1TestAppWithState({
      internalIdentity: { issuer: TEST_GATEWAY_ISSUER, audience: TEST_BACKEND_AUDIENCE, jwks: jwt.jwks }
    });
    app = testApp.app;
    state = testApp.state;
  });

  afterEach(async () => {
    await app.close();
  });

  it('does not execute duplicate ActionDraft confirms with the same idempotency key', async () => {
    const initialToolCallCount = state.toolCalls.length;

    const firstResponse = await request(app.getHttpServer())
      .post('/api/v1/assistant/action-drafts/action-draft-waiting-001/confirm')
      .set(headers('req-us3-duplicate-confirm-1', ['orders:read', 'orders:update']))
      .send({ idempotencyKey: 'idem-us3-duplicate-confirm' });

    const duplicateResponse = await request(app.getHttpServer())
      .post('/api/v1/assistant/action-drafts/action-draft-waiting-001/confirm')
      .set(headers('req-us3-duplicate-confirm-2', ['orders:read', 'orders:update']))
      .send({ idempotencyKey: 'idem-us3-duplicate-confirm' });

    expect(firstResponse.status).toBe(200);
    expect(duplicateResponse.status).toBe(200);
    expect(duplicateResponse.body.data).toEqual(
      expect.objectContaining({
        duplicateSafe: true,
        recheck: expect.objectContaining({ idempotency: 'duplicate' })
      })
    );
    expect(state.toolCalls.slice(initialToolCallCount)).toHaveLength(1);
    expect(state.auditEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: 'side_effect_execution_skipped_duplicate',
          metadata: expect.objectContaining({
            idempotencyStatus: 'duplicate',
            executionStatus: 'skipped_duplicate'
          })
        })
      ])
    );
    expect(JSON.stringify(state.auditEvents)).not.toContain('idem-us3-duplicate-confirm');
  });

  it('does not execute duplicate ApprovalRequest approves with the same idempotency key', async () => {
    const initialToolCallCount = state.toolCalls.length;

    const firstResponse = await request(app.getHttpServer())
      .post('/api/v1/assistant/approval-requests/approval-request-pending-approve-001/approve')
      .set(headers('req-us3-duplicate-approve-1', ['orders:read', 'orders:approve'], { roles: ['approver'] }))
      .send({ idempotencyKey: 'idem-us3-duplicate-approve' });

    const duplicateResponse = await request(app.getHttpServer())
      .post('/api/v1/assistant/approval-requests/approval-request-pending-approve-001/approve')
      .set(headers('req-us3-duplicate-approve-2', ['orders:read', 'orders:approve'], { roles: ['approver'] }))
      .send({ idempotencyKey: 'idem-us3-duplicate-approve' });

    const conflictingRetry = await request(app.getHttpServer())
      .post('/api/v1/assistant/approval-requests/approval-request-pending-approve-001/approve')
      .set(headers('req-us3-duplicate-approve-3', ['orders:read', 'orders:approve'], { roles: ['approver'] }))
      .send({ idempotencyKey: 'idem-us3-duplicate-approve-new' });

    expect(firstResponse.status).toBe(200);
    expect(duplicateResponse.status).toBe(200);
    expect(duplicateResponse.body.data).toEqual(expect.objectContaining({ duplicateSafe: true }));
    expect(conflictingRetry.status).toBe(409);
    expect(state.toolCalls.slice(initialToolCallCount)).toHaveLength(1);
    expect(JSON.stringify(state.auditEvents)).not.toContain('idem-us3-duplicate-approve');
  });

  it('fails closed when permission scope changes before ActionDraft confirmation', async () => {
    const initialToolCallCount = state.toolCalls.length;

    const response = await request(app.getHttpServer())
      .post('/api/v1/assistant/action-drafts/action-draft-waiting-001/confirm')
      .set(headers('req-us3-action-permission-denied', ['orders:read']))
      .send({ idempotencyKey: 'idem-us3-action-permission-denied' });

    expect(response.status).toBe(403);
    expect(state.toolCalls.slice(initialToolCallCount)).toHaveLength(0);
    expect(state.auditEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: 'side_effect_execution_denied',
          metadata: expect.objectContaining({ deniedReason: 'missing_scope' })
        })
      ])
    );
  });

  it('fails closed when a side-effect tool becomes inactive or mismatched before confirmation', async () => {
    const inactiveTool = state.toolDefinitions.find((tool) => tool.name === 'mock.orders.status.update');
    if (!inactiveTool) {
      throw new Error('Missing mock.orders.status.update fixture.');
    }
    inactiveTool.isActive = false;

    const inactiveResponse = await request(app.getHttpServer())
      .post('/api/v1/assistant/action-drafts/action-draft-waiting-001/confirm')
      .set(headers('req-us3-action-tool-inactive', ['orders:read', 'orders:update']))
      .send({ idempotencyKey: 'idem-us3-action-tool-inactive' });

    expect(inactiveResponse.status).toBe(403);
    expect(state.auditEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: 'side_effect_execution_denied',
          metadata: expect.objectContaining({ deniedReason: 'tool_inactive' })
        })
      ])
    );

    inactiveTool.isActive = true;
    inactiveTool.operation = ToolOperation.delete;

    const mismatchResponse = await request(app.getHttpServer())
      .post('/api/v1/assistant/action-drafts/action-draft-draft-001/confirm')
      .set(headers('req-us3-action-tool-mismatch', ['orders:read', 'orders:update']))
      .send({ idempotencyKey: 'idem-us3-action-tool-mismatch' });

    expect(mismatchResponse.status).toBe(403);
    expect(state.auditEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: 'side_effect_execution_denied',
          metadata: expect.objectContaining({ deniedReason: 'tool_contract_mismatch' })
        })
      ])
    );
  });

  it('fails closed when ActionDraft tool version or confirmation contract changes before confirmation', async () => {
    const initialToolCallCount = state.toolCalls.length;
    const updateTool = state.toolDefinitions.find((tool) => tool.name === 'mock.orders.status.update');
    if (!updateTool) {
      throw new Error('Missing mock.orders.status.update fixture.');
    }
    updateTool.version = '2.0.0';

    const versionResponse = await request(app.getHttpServer())
      .post('/api/v1/assistant/action-drafts/action-draft-waiting-001/confirm')
      .set(headers('req-us3-action-tool-version', ['orders:read', 'orders:update']))
      .send({ idempotencyKey: 'idem-us3-action-tool-version' });

    expect(versionResponse.status).toBe(403);
    expect(state.toolCalls.slice(initialToolCallCount)).toHaveLength(0);

    updateTool.version = '1.0.0';
    updateTool.requiresConfirmation = false;

    const contractResponse = await request(app.getHttpServer())
      .post('/api/v1/assistant/action-drafts/action-draft-draft-001/confirm')
      .set(headers('req-us3-action-tool-contract', ['orders:read', 'orders:update']))
      .send({ idempotencyKey: 'idem-us3-action-tool-contract' });

    expect(contractResponse.status).toBe(403);
    expect(state.toolCalls.slice(initialToolCallCount)).toHaveLength(0);
    expect(state.auditEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: 'side_effect_execution_denied',
          metadata: expect.objectContaining({ deniedReason: 'tool_contract_mismatch' })
        })
      ])
    );
    expect(JSON.stringify(state.auditEvents)).not.toContain('idem-us3-action-tool-version');
    expect(JSON.stringify(state.auditEvents)).not.toContain('rawPayload');
  });

  it('fails closed when an approval side-effect tool becomes inactive before approve execution', async () => {
    const initialToolCallCount = state.toolCalls.length;
    const cancelTool = state.toolDefinitions.find((tool) => tool.name === 'mock.orders.cancel');
    if (!cancelTool) {
      throw new Error('Missing mock.orders.cancel fixture.');
    }
    cancelTool.isActive = false;

    const response = await request(app.getHttpServer())
      .post('/api/v1/assistant/approval-requests/approval-request-pending-approve-001/approve')
      .set(headers('req-us3-approval-tool-inactive', ['orders:read', 'orders:approve'], { roles: ['approver'] }))
      .send({ idempotencyKey: 'idem-us3-approval-tool-inactive' });

    expect(response.status).toBe(403);
    expect(state.toolCalls.slice(initialToolCallCount)).toHaveLength(0);
    expect(state.auditEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: 'side_effect_execution_denied',
          metadata: expect.objectContaining({ deniedReason: 'tool_inactive' })
        })
      ])
    );
  });

  it('fails closed when ApprovalRequest tool operation, version, or approval contract changes before approve execution', async () => {
    const initialToolCallCount = state.toolCalls.length;
    const cancelTool = state.toolDefinitions.find((tool) => tool.name === 'mock.orders.cancel');
    if (!cancelTool) {
      throw new Error('Missing mock.orders.cancel fixture.');
    }
    cancelTool.operation = ToolOperation.delete;

    const operationResponse = await request(app.getHttpServer())
      .post('/api/v1/assistant/approval-requests/approval-request-pending-approve-001/approve')
      .set(headers('req-us3-approval-tool-operation', ['orders:read', 'orders:approve'], { roles: ['approver'] }))
      .send({ idempotencyKey: 'idem-us3-approval-tool-operation' });

    expect(operationResponse.status).toBe(403);

    cancelTool.operation = ToolOperation.update;
    cancelTool.version = '2.0.0';

    const versionResponse = await request(app.getHttpServer())
      .post('/api/v1/assistant/approval-requests/approval-request-pending-denied-001/approve')
      .set(headers('req-us3-approval-tool-version', ['orders:read', 'orders:approve'], { roles: ['approver'] }))
      .send({ idempotencyKey: 'idem-us3-approval-tool-version' });

    expect(versionResponse.status).toBe(403);

    cancelTool.version = '1.0.0';
    cancelTool.requiresApproval = false;

    const contractResponse = await request(app.getHttpServer())
      .post('/api/v1/assistant/approval-requests/approval-request-pending-get-001/approve')
      .set(headers('req-us3-approval-tool-contract', ['orders:read', 'orders:approve'], { roles: ['approver'] }))
      .send({ idempotencyKey: 'idem-us3-approval-tool-contract' });

    expect(contractResponse.status).toBe(403);
    expect(state.toolCalls.slice(initialToolCallCount)).toHaveLength(0);
    expect(state.auditEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: 'side_effect_execution_denied',
          metadata: expect.objectContaining({ deniedReason: 'tool_contract_mismatch' })
        })
      ])
    );
    expect(JSON.stringify(state.auditEvents)).not.toContain('idem-us3-approval-tool-version');
    expect(JSON.stringify(state.auditEvents)).not.toContain('rawPayload');
  });

  it('fails closed before side-effect execution on host app boundary mismatch', async () => {
    const initialToolCallCount = state.toolCalls.length;

    const response = await request(app.getHttpServer())
      .post('/api/v1/assistant/action-drafts/action-draft-waiting-001/confirm')
      .set(headers('req-us3-action-boundary', ['orders:read', 'orders:update'], { hostApp: 'crm' }))
      .send({ idempotencyKey: 'idem-us3-action-boundary' });

    expect(response.status).toBe(404);
    expect(state.toolCalls.slice(initialToolCallCount)).toHaveLength(0);
  });

  function headers(
    requestId: string,
    permissionScopes: string[],
    options: { roles?: string[]; hostApp?: string } = {}
  ) {
    return createAuthorizedInternalIdentityHeaders(jwt, {
      claims: {
        ...jwt.canonicalClaims.customerA,
        host_app: options.hostApp ?? 'erp',
        roles: options.roles ?? ['planner'],
        permission_scopes: permissionScopes
      },
      requestId
    });
  }
});
