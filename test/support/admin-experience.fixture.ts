import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestingModuleBuilder } from '@nestjs/testing';
import { RiskLevel, ToolOperation } from '../../src/generated/prisma/enums';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { ToolRegistryService } from '../../src/tools/tool-registry.service';
import type { RegisteredToolDefinition } from '../../src/tools/tool-registry.types';
import { OTHER_TEST_CUSTOMER } from './admin-operations.fixture';
import { ADMIN_TEST_CUSTOMER } from './admin-test-app.helper';

/** Feature 016: the synthetic Feature 013 pack (customer-a-experience), re-scoped to the admin test customer. */
export const ADMIN_EXPERIENCE_INTEGRATION = 'integration-admin-f016';
export const OTHER_EXPERIENCE_INTEGRATION = 'integration-admin-f016-other';
export const ADMIN_EXPERIENCE_HOST_APP = 'erp';

/** Writes the pack to a temporary file (the loader takes absolute paths) and returns ASSISTANT_CAPABILITY_PACK_PATHS_JSON. */
export function adminExperiencePackPaths(): string {
  const pack = JSON.parse(readFileSync('test/fixtures/capability-packs/customer-a-experience.v1.json', 'utf8')) as Record<string, unknown>;
  const path = join(mkdtempSync(join(tmpdir(), 'admin-f016-')), 'admin-experience.v1.json');
  writeFileSync(path, JSON.stringify({ ...pack, packId: 'admin-f016-experience', customerId: ADMIN_TEST_CUSTOMER,
    integrationId: ADMIN_EXPERIENCE_INTEGRATION, hostApps: [ADMIN_EXPERIENCE_HOST_APP] }));
  return JSON.stringify([path]);
}

function tool(key: string, argument?: string): RegisteredToolDefinition {
  return {
    id: `fixture-${key}`, key, name: key, version: '1.0.0', description: '', operation: ToolOperation.read, riskLevel: RiskLevel.low,
    active: true, connectorKey: 'mock', timeoutMs: 1000, requiredPermissionScopes: [],
    inputSchema: { type: 'object', additionalProperties: false, required: argument ? [argument] : [],
      properties: argument ? { [argument]: { type: 'string' } } : {} },
    outputSchema: { type: 'object', required: [], properties: {} },
    hasSideEffect: false, requiresConfirmation: false, requiresApproval: false
  };
}

const TOOLS: Readonly<Record<string, RegisteredToolDefinition>> = Object.fromEntries([
  tool('experience.work-orders.today'), tool('experience.work-orders.weekly'), tool('experience.work-orders.monthly'),
  tool('mock.orders.status.lookup', 'entityId'), tool('mock.inventory.availability.lookup', 'entityId')
].map((definition) => [definition.key, definition]));

/** The Tool registry the pack loader and binding resolver check, without Tool rows in the test database. */
export function withFixtureTools(builder: TestingModuleBuilder): TestingModuleBuilder {
  const validator = new ToolRegistryService({} as never, {} as never);
  return builder.overrideProvider(ToolRegistryService).useValue({
    resolveExactExecutableTool: async (key: string, version: string) =>
      TOOLS[key]?.version === version ? { tool: TOOLS[key] } : { deniedReason: 'tool_not_registered' },
    validateNamedOperation: (definition: RegisteredToolDefinition, candidate: unknown) => validator.validateNamedOperation(definition, candidate)
  });
}

/** This customer's integration, another customer's, and no experience configuration rows. */
export async function resetExperienceData(db: PrismaClient): Promise<void> {
  const integrationId = { in: [ADMIN_EXPERIENCE_INTEGRATION, OTHER_EXPERIENCE_INTEGRATION] };
  await db.assistantExperienceConfig.deleteMany({ where: { integrationId } });
  await db.integrationBinding.deleteMany({ where: { integrationId } });
  await db.customer.upsert({ where: { id: OTHER_TEST_CUSTOMER }, create: { id: OTHER_TEST_CUSTOMER }, update: {} });
  await db.integrationBinding.createMany({ data: [
    { integrationId: ADMIN_EXPERIENCE_INTEGRATION, customerId: ADMIN_TEST_CUSTOMER, allowedHostApp: ADMIN_EXPERIENCE_HOST_APP },
    { integrationId: OTHER_EXPERIENCE_INTEGRATION, customerId: OTHER_TEST_CUSTOMER, allowedHostApp: ADMIN_EXPERIENCE_HOST_APP }
  ] });
}

/** A valid edit: greeting, an overview and a capability Quick Reply, and one follow-up. New items have no ID. */
export function editedConfig(baseConfigVersion: string | null, greeting = '你好，我可以協助查詢工單。') {
  return {
    baseConfigVersion,
    greeting: { text: greeting },
    maxQuickReplies: 4,
    quickReplies: [
      { kind: 'capability_overview', label: '你能查詢哪些資料？', message: '你能查詢哪些資料？', priority: 100 },
      { id: 'work-orders-today', kind: 'capability', label: '今天新增幾張工單？', message: '今天新增多少工單？',
        capabilityKey: 'work-orders.count', parameters: { timeRange: 'today' }, priority: 90 }
    ],
    followUps: [
      { whenCapabilityKey: 'work-orders.count', whenParameters: { timeRange: 'today' }, label: '那本週呢？', message: '本週新增多少工單？',
        capabilityKey: 'work-orders.count', parameters: { timeRange: 'this_week' } }
    ]
  };
}
