import { resolve } from 'node:path';
import { CapabilityBindingResolverService } from '../../src/capabilities/capability-binding-resolver.service';
import { CapabilityCatalogRegistry } from '../../src/capabilities/capability-catalog.registry';
import { CapabilityPackLoader, NODE_CAPABILITY_PACK_FILE_ACCESS } from '../../src/capabilities/capability-pack.loader';
import { CapabilityParameterResolverService } from '../../src/capabilities/capability-parameter-resolver.service';
import { CapabilitySemanticResolverService } from '../../src/capabilities/capability-semantic-resolver.service';
import { RiskLevel, ToolOperation } from '../../src/generated/prisma/enums';
import { ToolRegistryService } from '../../src/tools/tool-registry.service';
import type { RegisteredToolDefinition } from '../../src/tools/tool-registry.types';

const definitions: Readonly<Record<string, RegisteredToolDefinition>> = Object.freeze(Object.fromEntries([
  referenceTool('work-orders.monthly-new-count', 'customer-shinmone-scm-local'),
  referenceTool('inventory.stock-on-hand', 'customer-b', 'sku'),
  referenceTool('mock.orders.status.lookup', 'customer-a', 'entityId'),
  referenceTool('mock.work-orders.progress.lookup', 'customer-a', 'entityId'),
  referenceTool('mock.inventory.availability.lookup', 'customer-a', 'entityId'),
  referenceTool('mock.business-partner.history.lookup', 'customer-a', 'entityId')
].map(([customerId, tool]) => [tool.key, Object.freeze({ ...tool, fixtureCustomerId: customerId })])) as Record<string, RegisteredToolDefinition>);

function referenceTool(key: string, customerId: string, argument?: string): readonly [string, RegisteredToolDefinition] {
  return [customerId, {
    id: `fixture-${key}`, key, name: key, version: '1.0.0', description: '',
    operation: ToolOperation.read, riskLevel: RiskLevel.low, active: true,
    connectorKey: 'mock', timeoutMs: 1000, requiredPermissionScopes: [],
    inputSchema: {
      type: 'object', additionalProperties: false,
      required: argument ? [argument] : [],
      properties: argument ? { [argument]: { type: 'string' } } : {}
    },
    outputSchema: { type: 'object', required: [], properties: {} },
    hasSideEffect: false, requiresConfirmation: false, requiresApproval: false
  }];
}

export async function createFeature011DirectHarness(relativePaths: readonly string[]) {
  const validator = new ToolRegistryService({} as never, {} as never);
  const tools = {
    resolveExactExecutableTool: jest.fn(async (key: string, version: string) => {
      const tool = definitions[key];
      return tool && tool.version === version ? { tool } : { deniedReason: 'tool_not_registered' };
    }),
    resolveExactToolForCustomer: jest.fn(async (key: string, version: string, customerId: string) => {
      const tool = definitions[key];
      const owner = (tool as RegisteredToolDefinition & { fixtureCustomerId?: string } | undefined)?.fixtureCustomerId;
      return tool && tool.version === version && owner === customerId
        ? { resolved: { tool, requiredRoles: [], requiredPermissionScopes: [] } }
        : { deniedReason: 'customer_policy_denied' };
    }),
    validateNamedOperation: jest.fn((tool: RegisteredToolDefinition, candidate: unknown) =>
      validator.validateNamedOperation(tool, candidate))
  };
  const registry = new CapabilityCatalogRegistry();
  const loader = new CapabilityPackLoader(registry, tools as never, NODE_CAPABILITY_PACK_FILE_ACCESS);
  await loader.loadAndInstall(JSON.stringify(relativePaths.map((path) => resolve(path))));
  const audit = { record: jest.fn(async (_metadata: unknown) => undefined) };
  const semantic = new CapabilitySemanticResolverService();
  const parameters = new CapabilityParameterResolverService();
  const binding = new CapabilityBindingResolverService(tools as never);
  return { registry, tools, audit, semantic, parameters, binding };
}
