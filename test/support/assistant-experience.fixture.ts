import { RiskLevel, ToolOperation } from '../../src/generated/prisma/enums';
import type { HostIntegrationContext } from '../../src/host-integration/host-integration.types';
import type { RegisteredToolDefinition } from '../../src/tools/tool-registry.types';
import { createFeature011DirectHarness } from './feature011-direct.fixture';

/** Synthetic Customer A pack used by Feature 013 Core tests (no customer-specific vocabulary). */
export const EXPERIENCE_PACK = 'test/fixtures/capability-packs/customer-a-experience.v1.json';

export const EXPERIENCE_HOST: HostIntegrationContext = Object.freeze({
  customerId: 'customer-a', integrationId: 'integration-erp', hostApp: 'erp', organizationId: 'org-a',
  actorId: 'actor-a', roles: [], permissionScopes: ['work-orders:read', 'work-orders:monthly'], requestId: 'request-a'
});

function workOrderTool(suffix: string, scopes: readonly string[]): RegisteredToolDefinition {
  const key = `experience.work-orders.${suffix}`;
  return {
    id: `fixture-${key}`, key, name: key, version: '1.0.0', description: '工單新增數量',
    operation: ToolOperation.read, riskLevel: RiskLevel.low, active: true, connectorKey: 'mock', timeoutMs: 1000,
    requiredPermissionScopes: [...scopes],
    inputSchema: { type: 'object', additionalProperties: false, required: [], properties: {} },
    outputSchema: { type: 'object', required: [], properties: {} },
    hasSideEffect: false, requiresConfirmation: false, requiresApproval: false
  };
}

/** today / weekly require work-orders:read; monthly additionally requires work-orders:monthly. */
export async function createExperienceHarness() {
  return createFeature011DirectHarness([EXPERIENCE_PACK], { additionalTools: {
    'experience.work-orders.today': { customerId: 'customer-a', tool: workOrderTool('today', ['work-orders:read']) },
    'experience.work-orders.weekly': { customerId: 'customer-a', tool: workOrderTool('weekly', ['work-orders:read']) },
    'experience.work-orders.monthly': { customerId: 'customer-a', tool: workOrderTool('monthly', ['work-orders:read', 'work-orders:monthly']) }
  } });
}
