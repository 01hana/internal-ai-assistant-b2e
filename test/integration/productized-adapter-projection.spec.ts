import { LlmInputSanitizerService } from '../../src/permissions/llm-input-sanitizer.service';
import { AdapterResultProjectorService } from '../../src/connectors/adapter-result-projector.service';
import { DataAdapterRegistry } from '../../src/connectors/data-adapter-registry.service';
import {
  ProductizedBusinessConnectorAdapter,
  type ProductizedAdapterBinding
} from '../../src/connectors/productized-business/productized-business-connector.adapter';
import { AssistantReadonlyRuntimeService } from '../../src/assistant/runtime/assistant-readonly-runtime.service';
import type { AssistantReadonlyRuntimeInput } from '../../src/assistant/runtime/runtime.types';
import { createCustomerScopeFromIdentityContext } from '../../src/identity/customer-scope.factory';
import { ExecutionDecision, RiskLevel, ToolOperation } from '../../src/generated/prisma/enums';

describe('productized adapter Feature 008 projection boundary', () => {
  it('releases a bounded local success only through the real Feature 008 runtime and projector', async () => {
    const tool = definition();
    const transport = {
      executionConstraints: jest.fn(() => ({ ok: true, maxTransportMs: 4_500, productionReady: true })),
      invoke: jest.fn().mockResolvedValue({
        ok: true,
        value: {
          version: '1', requestId: 'request-b', status: 'succeeded',
          result: { sku: 'SKU-001', quantity: 12 }
        }
      })
    };
    const toolRegistry = runtimeToolRegistry(tool);
    const adapter = new ProductizedBusinessConnectorAdapter(
      binding(),
      toolRegistry as never,
      transport as never,
      { nowMilliseconds: jest.fn(() => 0) }
    );
    const projector = new AdapterResultProjectorService(new LlmInputSanitizerService());
    const project = jest.spyOn(projector, 'project');
    const startToolCall = jest.fn().mockResolvedValue({ toolCall: { id: 'tool-call-productized' } });
    const completeToolCall = jest.fn().mockResolvedValue({ toolCall: { id: 'tool-call-productized' } });
    const failToolCall = jest.fn();
    const registry = new DataAdapterRegistry(Object.freeze([Object.freeze({
      adapter,
      connectorKey: 'business',
      customerId: 'customer-b',
      integrationId: 'inventory-b',
      hostApp: 'customer-b-inventory',
      active: true
    })]));
    const runtime = new AssistantReadonlyRuntimeService(
      toolRegistry as never,
      { checkResolvedCustomerTool: jest.fn().mockResolvedValue({ allowed: true }) } as never,
      { startToolCall, completeToolCall, failToolCall } as never,
      projector,
      registry
    );

    const result = await runtime.execute(runtimeInput());

    expect(result).toEqual(expect.objectContaining({
      toolLifecycle: 'completed',
      connectorStatus: 'succeeded',
      projectedResult: {
        kind: 'safe_projected_adapter_result',
        canonicalToolKey: 'inventory.stock-on-hand',
        schemaVersion: '1.0.0',
        facts: { sku: 'SKU-001', quantity: 12 },
        fieldPaths: ['quantity', 'sku'],
        evidenceProvenance: { sku: 'SKU-001' }
      }
    }));
    expect(startToolCall).toHaveBeenCalledTimes(1);
    expect(completeToolCall).toHaveBeenCalledWith(expect.objectContaining({
      toolCallId: 'tool-call-productized',
      projectedResult: result.projectedResult
    }));
    expect(failToolCall).not.toHaveBeenCalled();
    expect(project).toHaveBeenCalledWith(expect.objectContaining({
      rawResult: { sku: 'SKU-001', quantity: 12 }
    }));
    expect(transport.invoke).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(completeToolCall.mock.calls)).not.toContain('ccr_phase9_reference');
  });

  it('fails the started ToolCall safely when the productized transport fails', async () => {
    const tool = definition();
    const toolRegistry = runtimeToolRegistry(tool);
    const transport = {
      executionConstraints: jest.fn(() => ({ ok: true, maxTransportMs: 4_500, productionReady: true })),
      invoke: jest.fn().mockResolvedValue({ ok: false, code: 'CONNECTOR_TIMEOUT' })
    };
    const adapter = new ProductizedBusinessConnectorAdapter(binding(), toolRegistry as never, transport as never);
    const registry = new DataAdapterRegistry(Object.freeze([Object.freeze({
      adapter, connectorKey: 'business', customerId: 'customer-b', integrationId: 'inventory-b',
      hostApp: 'customer-b-inventory', active: true
    })]));
    const projector = new AdapterResultProjectorService(new LlmInputSanitizerService());
    const project = jest.spyOn(projector, 'project');
    const failToolCall = jest.fn().mockResolvedValue({ toolCall: { id: 'tool-call-failed-productized' } });
    const completeToolCall = jest.fn();
    const runtime = new AssistantReadonlyRuntimeService(
      toolRegistry as never,
      { checkResolvedCustomerTool: jest.fn().mockResolvedValue({ allowed: true }) } as never,
      {
        startToolCall: jest.fn().mockResolvedValue({ toolCall: { id: 'tool-call-productized' } }),
        completeToolCall,
        failToolCall
      } as never,
      projector,
      registry
    );

    const result = await runtime.execute(runtimeInput());

    expect(result).toEqual(expect.objectContaining({
      toolLifecycle: 'failed',
      connectorStatus: 'failed',
      connectorErrorCode: 'TOOL_EXECUTION_FAILED'
    }));
    expect(failToolCall).toHaveBeenCalledWith(expect.objectContaining({
      toolCallId: 'tool-call-productized', errorCode: 'TOOL_EXECUTION_FAILED'
    }));
    expect(completeToolCall).not.toHaveBeenCalled();
    expect(project).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('ccr_phase9_reference');
  });

  it('rejects undeclared local fields before evidence release', () => {
    const projector = new AdapterResultProjectorService(new LlmInputSanitizerService());
    const projection = projector.project({
      tool: definition(),
      resultPolicy: { allowed: true, policy: resultPolicy() },
      rawResult: { sku: 'SKU-001', quantity: 12, privateCost: 'RAW_LOCAL_SECRET' },
      permissionScopes: ['inventory:read']
    });

    expect(projection).toEqual({ projected: false, errorCode: 'ADAPTER_RESULT_PROJECTION_FAILED' });
    expect(JSON.stringify(projection)).not.toContain('RAW_LOCAL_SECRET');
  });
});

function binding(): ProductizedAdapterBinding {
  return Object.freeze({
    version: '1', active: true, customerId: 'customer-b', integrationId: 'inventory-b',
    hostApp: 'customer-b-inventory', connectorKey: 'business',
    connectorInstanceId: 'customer-b-inventory-connector-1',
    operations: Object.freeze([Object.freeze({ key: 'inventory.stock-on-hand', version: '1.0.0' })])
  });
}

function runtimeToolRegistry(tool: ReturnType<typeof definition>) {
  return {
    resolveToolForCustomer: jest.fn().mockResolvedValue({
      resolved: { tool, requiredRoles: [], requiredPermissionScopes: [] }
    }),
    resolveExactExecutableTool: jest.fn().mockResolvedValue({ tool }),
    isExecutableReadOnly: jest.fn().mockReturnValue(true),
    validateNamedOperation: jest.fn().mockReturnValue({
      valid: true,
      operation: {
        canonicalToolKey: 'inventory.stock-on-hand',
        schemaVersion: '1.0.0',
        arguments: Object.freeze({ sku: 'SKU-001' })
      },
      safeInputSummary: {
        canonicalToolKey: 'inventory.stock-on-hand', schemaVersion: '1.0.0',
        argumentKeys: ['sku'], argumentCount: 1
      }
    }),
    resolveResultPolicy: jest.fn().mockReturnValue({ allowed: true, policy: resultPolicy() })
  };
}

function runtimeInput(): AssistantReadonlyRuntimeInput {
  const identity = {
    requestId: 'request-b',
    customer: { customerId: 'customer-b', integrationId: 'inventory-b' },
    organization: { organizationId: 'organization-b' },
    hostApp: { hostApp: 'customer-b-inventory' },
    actor: { actorId: 'actor-b', roles: ['operator'], permissionScopes: ['inventory:read'] },
    auth: { tokenId: 'token-b', gatewayIssuer: 'https://gateway.test.internal' }
  };
  return {
    customerScope: createCustomerScopeFromIdentityContext(identity),
    requestId: 'request-b',
    sessionId: 'session-b',
    sourceMessageId: 'message-user-b',
    responseMessageId: 'message-assistant-b',
    identityContext: identity,
    hostIntegrationContext: Object.freeze({
      customerId: 'customer-b', integrationId: 'inventory-b', hostApp: 'customer-b-inventory',
      organizationId: 'organization-b', actorId: 'actor-b', roles: Object.freeze(['operator']),
      permissionScopes: Object.freeze(['inventory:read']), requestId: 'request-b'
    }),
    transientConnectorContext: Object.freeze({ connectorContextRef: 'ccr_phase9_reference' }),
    executionPlan: {
      id: 'plan-b', customerId: 'customer-b', sessionId: 'session-b', messageId: 'message-user-b',
      taskType: 'inventory_lookup', requiredEvidence: [],
      candidateTools: [{ key: 'inventory.stock-on-hand', arguments: { sku: 'SKU-001' }, reason: 'stock lookup' }],
      permissionChecks: [], riskAssessment: RiskLevel.low, clarificationNeeds: null,
      expectedAnswerShape: {}, requiresMultiStepToolUse: false,
      decision: ExecutionDecision.continue, createdAt: new Date()
    },
    pageContext: undefined
  };
}

function definition() {
  return Object.freeze({
    id: 'tool-b', key: 'inventory.stock-on-hand', name: 'Inventory stock on hand', version: '1.0.0',
    description: 'Read stock.', operation: ToolOperation.read, riskLevel: RiskLevel.low, active: true,
    connectorKey: 'business', timeoutMs: 5_000, requiredPermissionScopes: ['inventory:read'],
    inputSchema: { type: 'object', properties: { sku: { type: 'string' } }, required: ['sku'] },
    outputSchema: {
      type: 'object', additionalProperties: false, required: ['sku', 'quantity'],
      properties: { sku: { type: 'string' }, quantity: { type: 'integer' } },
      'x-assistant-result-policy': resultPolicy()
    },
    hasSideEffect: false, requiresConfirmation: false, requiresApproval: false
  });
}

function resultPolicy() {
  return Object.freeze({
    version: '1' as const, allowedFieldPaths: Object.freeze(['sku', 'quantity']), deniedFieldPaths: Object.freeze([]),
    permissionMasks: Object.freeze([]), limits: Object.freeze({ maxDepth: 4, maxItems: 10, maxStringLength: 128, maxTotalBytes: 1024 }),
    evidenceSafeProvenanceFields: Object.freeze(['sku'])
  });
}
