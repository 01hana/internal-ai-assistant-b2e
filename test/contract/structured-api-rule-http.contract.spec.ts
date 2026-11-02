import type { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { parseConnectorInvocationRequestV1, parseConnectorOperationManifestV1 } from '@internal-ai-assistant/connector-runtime-contract';
import { OperationManifestRegistry } from '../../apps/customer-connector-runtime/src/manifest/operation-manifest.registry';
import { BoundedJsonResponse } from '../../apps/customer-connector-runtime/src/upstream/bounded-json-response';
import { ManifestResponseExtractor } from '../../apps/customer-connector-runtime/src/upstream/response-extractor';
import { MockConnectorAdapter } from '../../src/connectors/mock/mock-connector.adapter';
import type { DataAdapterExecuteInput } from '../../src/connectors/data-adapter.interface';
import type { ConnectorExecuteResult } from '../../src/connectors/connector-adapter.interface';
import { LlmExecutionService } from '../../src/llm/llm-execution.service';
import { createAuthorizedInternalIdentityHeaders, createUs1TestAppWithState, parseSseResponse } from '../support/us1-test-app.helper';
import { DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE } from '../support/internal-identity-jwt.helper';

const text = { type: 'string', maxLength: 64 };
const integer = { type: 'integer', minimum: 0 };
const count = { type: 'object', additionalProperties: false, required: ['Current', 'Previous'],
  properties: { Current: integer, Previous: integer } };
const closed = (properties: Record<string, unknown>) =>
  ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const approved = { itemSku: text, availableQuantity: count, incomingQuantity: integer, warehouseCode: text };
const manifest = { version: '1', connectorKey: 'mock', operations: [{
  operationKey: 'mock.inventory.availability.lookup', contractVersion: '1.0.0',
  inputSchema: closed({ entityId: text }), upstreamServiceRef: 'synthetic-inventory',
  request: { profile: 'GET_QUERY_V1', path: '/inventory', fixedQuery: {},
    argumentMappings: [{ argument: 'entityId', target: 'query', name: 'sku', scalarType: 'string' }] },
  credentialProfileRef: 'synthetic-user', readOnly: true,
  response: { validationProfile: 'FULL_CLOSED_SCHEMA_V1', acceptedHttpStatuses: [200],
    acceptedApplicationCodes: [200], applicationCodePointer: '/Code', contentType: 'application/json',
    schema: closed({ Code: integer, ...approved, InternalToken: text }),
    extraction: [], structuredOutputSchema: closed(approved) },
  limits: { maxRequestBytes: 1024, maxResponseBytes: 4096, maxDepth: 4, maxItems: 20,
    maxStringLength: 256, timeoutMs: 1000 }, errorMap: {}, readinessDependency: 'synthetic-inventory'
}] };

class StructuredInventoryAdapter extends MockConnectorAdapter {
  readonly calls: string[] = [];
  invalid = false;
  override async execute(input: DataAdapterExecuteInput): Promise<ConnectorExecuteResult> {
    if (input.toolKey !== 'mock.inventory.availability.lookup' ||
      input.operation.canonicalToolKey !== input.toolKey ||
      input.requestId !== input.host.requestId ||
      input.organizationId !== input.host.organizationId || input.actorId !== input.host.actorId ||
      JSON.stringify(input.arguments) !== JSON.stringify(input.operation.arguments)) {
      return { toolKey: input.toolKey, status: 'failed', error: { code: 'INVALID_CONTEXT', message: 'Invalid context.' } };
    }
    this.calls.push(input.requestId);
    const parsed = parseConnectorOperationManifestV1(manifest);
    if (!parsed.ok) throw new Error('STRUCTURED_MANIFEST_INVALID');
    const invocation = parseConnectorInvocationRequestV1(Buffer.from(JSON.stringify({
      version: '1', requestId: input.requestId, remainingBudgetMs: 1000,
      trustedContext: { customerId: input.host.customerId, integrationId: input.host.integrationId,
        hostApp: input.host.hostApp, organizationId: input.host.organizationId, actorId: input.host.actorId,
        connectorKey: 'mock', connectorInstanceId: 'synthetic-instance' },
      operation: { key: input.toolKey, version: input.operation.schemaVersion, arguments: input.operation.arguments },
      connectorContextRef: `ccr_${'A'.repeat(43)}`
    })));
    if (!invocation.ok) throw new Error('STRUCTURED_INVOCATION_INVALID');
    const operation = new OperationManifestRegistry([parsed.value]).prepare('mock', input.toolKey,
      input.operation.schemaVersion, invocation.value.operation.arguments);
    if (!operation.ok) throw new Error('STRUCTURED_OPERATION_INVALID');
    const wire = { Code: 200, itemSku: input.operation.arguments.entityId,
      availableQuantity: { Current: 8, Previous: 5 }, incomingQuantity: 2, warehouseCode: 'WH-A',
      InternalToken: 'synthetic-secret' };
    if (this.invalid) wire.availableQuantity.Current = 'invalid' as never;
    const bounded = await new BoundedJsonResponse().read({ statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: { async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(wire)); } }
    }, operation.value);
    if (!bounded.ok) return { toolKey: input.toolKey, status: 'failed',
      error: { code: bounded.code, message: 'Response rejected.' } };
    const extracted = new ManifestResponseExtractor().extract(bounded.value, operation.value,
      input.operation.arguments);
    return extracted.ok ? { toolKey: input.toolKey, status: 'succeeded', data: extracted.value }
      : { toolKey: input.toolKey, status: 'failed', error: { code: extracted.code, message: 'Extraction rejected.' } };
  }
}

describe('structured API evidence through rule-based HTTP path', () => {
  let app: INestApplication;
  const adapter = new StructuredInventoryAdapter();
  let state: Awaited<ReturnType<typeof createUs1TestAppWithState>>['state'];
  beforeAll(async () => {
    ({ app, state } = await createUs1TestAppWithState({
      dataAdapterRegistrationsFactory: ({ mockRegistrations }) => mockRegistrations.map((entry) => ({ ...entry, adapter })),
      augmentStateBeforeInit: (fixture) => {
        const tool = fixture.toolDefinitions.find((item) => item.id === 'tool-definition-inventory-001');
        if (!tool) throw new Error('INVENTORY_TOOL_MISSING');
        tool.outputSchema = { ...closed(approved),
          'x-assistant-result-policy': { version: '1',
            allowedFieldPaths: ['itemSku', 'availableQuantity', 'incomingQuantity'],
            deniedFieldPaths: ['warehouseCode'], permissionMasks: [], limits: { maxDepth: 4, maxItems: 20,
              maxStringLength: 256, maxTotalBytes: 4096 }, evidenceSafeProvenanceFields: ['itemSku'] } };
      }
    }));
    const tool = state.toolDefinitions.find((item) => item.id === 'tool-definition-inventory-001');
    if (!tool) throw new Error('INVENTORY_TOOL_MISSING');
    state.customerToolPolicies.push({ customerId: 'customer-a', toolDefinitionId: tool.id,
      enabled: true, requiredRoles: [], requiredPermissionScopes: [] });
    jest.spyOn(app.get(LlmExecutionService, { strict: false }), 'generateAnswer').mockResolvedValue({
      content: 'SKU-DEMO-RED 的目前庫存為 8。', finishReason: 'stop',
      metadata: { provider: 'openai', model: 'synthetic-test', fallbackUsed: false }
    });
  });
  afterAll(async () => { await app.close(); jest.restoreAllMocks(); });

  async function send(requestId: string, claims = { ...DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE.canonicalClaims.customerA,
    permission_scopes: ['orders:read', 'inventory:read'] }) {
    return request(app.getHttpServer()).post('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(createAuthorizedInternalIdentityHeaders(DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE, { claims, requestId }))
      .send({ message: '查詢庫存可用量 料號 SKU-DEMO-RED', pageContext: { module: 'inventory',
        entityType: 'item', entityId: 'SKU-DEMO-RED', visibleColumns: ['availableQuantity', 'incomingQuantity'] } });
  }

  it('keeps only approved nested facts across invocation, extraction, projection, Evidence and HTTP answer', async () => {
    const response = await send('req-structured-rule-success');
    const events = parseSseResponse(response.text);
    expect(response.status).toBe(200);
    expect(events.map((item) => item.event)).toEqual(['tool_call_started', 'tool_call_completed',
      'evidence_attached', 'answer_delta', 'final']);
    expect(adapter.calls).toEqual(['req-structured-rule-success']);
    const evidence = state.evidenceRefs.find((item) => item.requestId === 'req-structured-rule-success');
    expect(evidence).toEqual(expect.objectContaining({ sourceType: 'structured_record',
      fieldPaths: expect.arrayContaining(['availableQuantity.Current', 'availableQuantity.Previous']) }));
    expect(JSON.stringify(evidence?.summary)).not.toContain('synthetic-secret');
    expect(JSON.stringify(evidence?.summary)).not.toContain('WH-A');
    expect(events.at(-1)?.data.data).toEqual(expect.objectContaining({ answerDecision: 'answered',
      evidenceRefs: [evidence?.id] }));
    expect(response.text).not.toContain('synthetic-secret');
    expect(response.text).not.toContain('WH-A');
  });

  it('rejects malformed wire data without attaching Evidence', async () => {
    adapter.invalid = true;
    const response = await send('req-structured-rule-invalid');
    expect(response.status).toBe(200);
    expect(state.evidenceRefs.filter((item) => item.requestId === 'req-structured-rule-invalid')).toHaveLength(0);
    expect(response.text).not.toContain('synthetic-secret');
    adapter.invalid = false;
  });

  it('honors Customer Tool Policy denial before connector invocation', async () => {
    const policy = state.customerToolPolicies.find((item) => item.customerId === 'customer-a' &&
      item.toolDefinitionId === 'tool-definition-inventory-001');
    if (!policy) throw new Error('INVENTORY_POLICY_MISSING');
    const before = adapter.calls.length;
    policy.enabled = false;
    try {
      const response = await send('req-structured-rule-policy-denied');
      expect(response.status).toBe(200);
      expect(adapter.calls).toHaveLength(before);
      expect(state.evidenceRefs.filter((item) => item.requestId === 'req-structured-rule-policy-denied')).toHaveLength(0);
      expect(parseSseResponse(response.text).some((item) => item.event === 'evidence_attached')).toBe(false);
    } finally {
      policy.enabled = true;
    }
  });

  it.each([
    ['Customer', { customer_id: 'customer-b' }],
    ['Integration', { integration_id: 'other-integration' }],
    ['Organization', { org_id: 'other-org' }],
    ['HostApp', { host_app: 'other-host' }],
    ['Actor', { sub: 'other-actor' }]
  ])('retains %s ownership before connector invocation', async (label, override) => {
    const before = adapter.calls.length;
    const claims = { ...DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE.canonicalClaims.customerA, ...override,
      permission_scopes: ['orders:read', 'inventory:read'] };
    const response = await send(`req-structured-rule-foreign-${label}`, claims);
    expect(response.status).toBe(404);
    expect(adapter.calls).toHaveLength(before);
  });
});
