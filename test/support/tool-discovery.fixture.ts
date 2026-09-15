import { RiskLevel, ToolOperation } from '../../src/generated/prisma/enums';
import { ToolDiscoveryService } from '../../src/tools/tool-discovery.service';
import { ToolRegistryService } from '../../src/tools/tool-registry.service';
import type { RegisteredToolDefinition } from '../../src/tools/tool-registry.types';

const validator = new ToolRegistryService({} as never, {} as never);

export function createToolDiscoveryFixtureService(): ToolDiscoveryService {
  return new ToolDiscoveryService({
    listDiscoverableToolsForCustomer: jest.fn(async (scope: { customerId: string }) =>
      scope.customerId === 'customer-b' ? [DISCOVERY_FIXTURE_TOOLS[4]] : DISCOVERY_FIXTURE_TOOLS.slice(0, 4)
    ),
    validateNamedOperation: (tool: RegisteredToolDefinition, candidate: unknown) => validator.validateNamedOperation(tool, candidate)
  } as never);
}

export const DISCOVERY_FIXTURE_TOOLS: readonly RegisteredToolDefinition[] = Object.freeze([
  tool('mock.orders.status.lookup', 'mock', ['order'], ['status'], 'order_status_lookup', 'entityId', ['orderId']),
  tool('mock.work-orders.progress.lookup', 'mock', ['workOrder'], ['progress'], 'work_order_progress_lookup', 'entityId', ['workOrderId']),
  tool('mock.inventory.availability.lookup', 'mock', ['inventory'], ['availability'], 'inventory_availability_lookup', 'entityId', ['itemSku']),
  tool('mock.business-partner.history.lookup', 'mock', ['businessPartner'], ['history'], 'business_partner_history_lookup', 'entityId', ['customerId', 'supplierId']),
  tool('inventory.stock-on-hand', 'business', ['inventory', 'stock'], ['availability'], 'inventory_stock_lookup', 'sku', ['itemSku'])
]);

function tool(
  key: string,
  connectorKey: string,
  resources: string[],
  metrics: string[],
  taskType: string,
  argumentName: string,
  entityConcepts: string[]
): RegisteredToolDefinition {
  return Object.freeze({
    id: `fixture-${key}`, key, name: key, version: '1.0.0', description: 'Generic discovery fixture.',
    operation: ToolOperation.read, riskLevel: RiskLevel.low, active: true, connectorKey, timeoutMs: 3000,
    requiredPermissionScopes: [],
    inputSchema: {
      type: 'object', additionalProperties: false, required: [argumentName], properties: { [argumentName]: { type: 'string' } },
      'x-assistant-discovery-v1': {
        version: '1', locale: 'zh-TW', resourceConcepts: resources, intentConcepts: ['read', 'lookup'],
        metricConcepts: metrics, timeRangeConcepts: [], requiredConceptGroups: ['resource'],
        argumentBindings: [{ argumentName, source: 'entity_value', concepts: entityConcepts }],
        taskType, requiredEvidence: ['identity_context', 'structured_record']
      }
    },
    outputSchema: { type: 'object', required: [], properties: {} }, hasSideEffect: false,
    requiresConfirmation: false, requiresApproval: false
  });
}
