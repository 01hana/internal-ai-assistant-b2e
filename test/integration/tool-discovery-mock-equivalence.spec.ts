import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { MockConnectorAdapter } from '../../src/connectors/mock/mock-connector.adapter';
import { ToolRegistryService } from '../../src/tools/tool-registry.service';
import {
  createAuthorizedInternalIdentityHeaders,
  createUs1TestAppWithState,
  parseSseResponse,
  Us1TestState
} from '../support/us1-test-app.helper';
import { DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE } from '../support/internal-identity-jwt.helper';

type ReadPath = Readonly<{
  name: string;
  requestId: string;
  message: string;
  pageContext: Readonly<Record<string, unknown>>;
  toolKey: string;
  argument: Readonly<Record<string, string>>;
  permission: string;
  projectedField: string;
  projectedValue: unknown;
  sourceId: string;
}>;

const READ_PATHS: readonly ReadPath[] = [
  {
    name: 'order status', requestId: 'req-discovery-equivalence-order',
    message: '請幫我查 SO-10001 訂單目前狀態',
    pageContext: { module: 'orders', entityType: 'order', entityId: 'SO-10001', visibleColumns: ['status'] },
    toolKey: 'mock.orders.status.lookup',
    argument: { entityId: 'SO-10001' }, permission: 'orders:read', projectedField: 'status', projectedValue: 'picking', sourceId: 'SO-10001'
  },
  {
    name: 'work-order progress', requestId: 'req-discovery-equivalence-work-order',
    message: '請查 WO-20002 工單進度',
    pageContext: { module: 'work-orders', entityType: 'workOrder', entityId: 'WO-20002', visibleColumns: ['status', 'completedQuantity'] },
    toolKey: 'mock.work-orders.progress.lookup',
    argument: { entityId: 'WO-20002' }, permission: 'work-orders:read', projectedField: 'completedQuantity', projectedValue: 24, sourceId: 'WO-20002'
  },
  {
    name: 'inventory availability', requestId: 'req-discovery-equivalence-inventory',
    message: '請查 SKU-DEMO-RED 庫存可用量',
    pageContext: { module: 'inventory', entityType: 'itemSku', entityId: 'SKU-DEMO-RED', visibleColumns: ['availableQuantity'] },
    toolKey: 'mock.inventory.availability.lookup',
    argument: { entityId: 'SKU-DEMO-RED' }, permission: 'inventory:read', projectedField: 'availableQuantity', projectedValue: 36, sourceId: 'SKU-DEMO-RED'
  },
  {
    name: 'business-partner history', requestId: 'req-discovery-equivalence-partner',
    message: '請查這筆客戶歷史',
    pageContext: { module: 'customers', entityType: 'customer', entityId: 'BP-CUSTOMER-001', visibleColumns: ['relationshipStatus', 'openItemCount'] },
    toolKey: 'mock.business-partner.history.lookup',
    argument: { entityId: 'BP-CUSTOMER-001' }, permission: 'business-partners:read', projectedField: 'relationshipStatus', projectedValue: 'active', sourceId: 'BP-CUSTOMER-001'
  }
];

describe('T093 metadata-discovery complete mock equivalence', () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it.each(READ_PATHS)('preserves the complete $name Feature 008 path', async (path) => {
    const fixture = await createUs1TestAppWithState();
    app = fixture.app;
    const state: Us1TestState = fixture.state;
    const adapter = app.get(MockConnectorAdapter);
    const registry = app.get(ToolRegistryService);
    const execute = jest.spyOn(adapter, 'execute');
    const resolveTool = jest.spyOn(registry, 'resolveToolForCustomer');

    const response = await request(app.getHttpServer())
      .post('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(createAuthorizedInternalIdentityHeaders(DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE, {
        claims: { permission_scopes: ['orders:read', 'work-orders:read', 'inventory:read', 'business-partners:read'] },
        requestId: path.requestId
      }))
      .send({ message: path.message, pageContext: path.pageContext });

    expect(response.status).toBe(200);
    const events = parseSseResponse(response.text);
    expect(events.map(({ event }) => event)).toEqual([
      'tool_call_started', 'tool_call_completed', 'evidence_attached', 'answer_delta', 'final'
    ]);

    const plan = state.executionPlans.at(-1);
    expect(plan?.candidateTools).toEqual([{ key: path.toolKey, arguments: path.argument, reason: 'metadata_discovery' }]);
    expect(plan?.decision).toBe('continue');

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      toolKey: path.toolKey,
      operation: expect.objectContaining({ canonicalToolKey: path.toolKey, arguments: path.argument })
    }));

    const toolCall = state.toolCalls.at(-1);
    expect(toolCall).toEqual(expect.objectContaining({
      toolName: path.toolKey,
      status: 'success'
    }));
    expect(resolveTool).toHaveBeenCalledWith(path.toolKey, expect.objectContaining({ customerId: 'customer-a' }));
    expect(toolCall?.permissionResult).toEqual(expect.objectContaining({ scopes: expect.arrayContaining([path.permission]) }));
    expect(toolCall?.outputSummary).toEqual(expect.objectContaining({ canonicalToolKey: path.toolKey }));

    const evidence = state.evidenceRefs.at(-1);
    expect(evidence).toEqual(expect.objectContaining({
      toolCallId: toolCall?.id,
      sourceId: path.sourceId,
      summary: { fields: expect.objectContaining({ [path.projectedField]: path.projectedValue }) }
    }));
    expect(state.answerDecisions.at(-1)).toEqual(expect.objectContaining({ status: 'answered' }));
    expect(events.at(-1)?.data?.data).toEqual(expect.objectContaining({ answerDecision: 'answered' }));
  });
});
