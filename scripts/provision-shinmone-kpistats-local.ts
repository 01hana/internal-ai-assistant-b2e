import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { parseConnectorOperationManifestV1 } from '@internal-ai-assistant/connector-runtime-contract';
import { parseCustomerCapabilityPackV1 } from '../src/capabilities/capability-pack.parser';
import { Prisma, type PrismaClient } from '../src/generated/prisma/client';
import { RiskLevel, ToolOperation } from '../src/generated/prisma/enums';
import { createPrismaClient } from '../src/prisma/prisma-client.factory';

const customerId = 'customer-shinmone-scm-local';
const integrationId = 'shinmone-scm-assistant-local';
const hostApp = 'shinmone-scm';
const permission = 'menu:SCM_DASHBOARD:read';
const c01Keys = ['work-orders.monthly-new-count', 'work-orders.today-new-count', 'work-orders.weekly-new-count'];
const demoKeys = ['shinmone.kpistats.snapshot.today', 'shinmone.kpistats.snapshot.weekly', 'shinmone.kpistats.snapshot.monthly'];
const wirePeriods = ['today', 'thisWeek', 'thisMonth'];
const catalogPath = resolve('test/fixtures/shinmone-kpistats-demo-tool-catalog.json');
const manifestPath = resolve('apps/customer-connector-runtime/integrations/shinmone/kpistats-six-metric.demo.manifest.json');
const packPath = resolve('customer-capability-packs/shinmone-scm-kpistats-demo/1.0.0.json');

type Mode = 'dry-run' | 'prepare' | 'activate' | 'rollback' | 'verify-demo' | 'verify-c01' | 'verify-default';
type VerifiedBackend = Readonly<{ startedAt: Date }>;
type LocalManager = {
  ROOT: string; STATE_FILE: string; BACKEND_COMPILED_ENTRYPOINT: string;
  compiledFiles(root: string): string[];
  hashFilesAndValues(paths: string[], values: Record<string, unknown>): string;
  readEnvFile(path: string): Record<string, string>;
  portOwner(port: number): number | undefined;
};
type CatalogTool = Readonly<{
  name: string; version: string; description: string; resource: string;
  inputSchema: Record<string, unknown>; outputSchema: Record<string, unknown>;
  requiredPermissions: string[]; timeoutMs: number;
}>;

export function loadLocalKpiCatalog(): readonly CatalogTool[] {
  const catalog: unknown = JSON.parse(readFileSync(catalogPath, 'utf8'));
  const rawManifest: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const manifest = parseConnectorOperationManifestV1(rawManifest);
  const pack = parseCustomerCapabilityPackV1(JSON.parse(readFileSync(packPath, 'utf8')));
  if (!record(catalog) || catalog.status !== 'staged-only' || catalog.customerId !== customerId ||
      catalog.integrationId !== integrationId || !Array.isArray(catalog.tools) || catalog.tools.length !== 3 ||
      !manifest.ok || pack.active !== false || pack.customerId !== customerId ||
      pack.integrationId !== integrationId || !pack.hostApps.includes(hostApp)) invalid();
  const tools = catalog.tools as unknown[];
  for (let index = 0; index < 3; index += 1) {
    const tool = tools[index];
    const operation = manifest.value.operations[index];
    const binding = pack.bindings[index];
    if (!record(tool) || !record(tool.inputSchema) || !record(tool.outputSchema) ||
        tool.name !== demoKeys[index] || tool.version !== '1.0.0' || tool.isActive !== false ||
        tool.operation !== 'read' || tool.riskLevel !== 'low' || tool.hasSideEffect !== false ||
        tool.requiresConfirmation !== false || tool.requiresApproval !== false || tool.connectorKey !== 'business' ||
        !Array.isArray(tool.requiredPermissions) || tool.requiredPermissions.length !== 1 ||
        tool.requiredPermissions[0] !== permission || typeof tool.description !== 'string' ||
        typeof tool.resource !== 'string' || !Number.isSafeInteger(tool.timeoutMs) ||
        operation?.operationKey !== demoKeys[index] || operation.contractVersion !== '1.0.0' ||
        !operation.readOnly || operation.request.profile !== 'GET_QUERY_V1' ||
        operation.request.path !== '/Dashboard/KPIStats' ||
        operation.request.fixedQuery.length !== 1 || operation.request.fixedQuery[0]?.name !== 'TimeRange' ||
        operation.request.fixedQuery[0]?.value !== wirePeriods[index] || operation.request.argumentMappings.length !== 0 ||
        operation.inputSchema.type !== 'object' || operation.inputSchema.additionalProperties !== false ||
        operation.inputSchema.properties.length !== 0 || operation.inputSchema.required.length !== 0 ||
        tool.inputSchema.type !== 'object' || tool.inputSchema.additionalProperties !== false ||
        !record(tool.inputSchema.properties) || Object.keys(tool.inputSchema.properties).length !== 0 ||
        !Array.isArray(tool.inputSchema.required) || tool.inputSchema.required.length !== 0 ||
        binding?.target.kind !== 'TOOL' || binding.target.toolKey !== demoKeys[index] ||
        binding.target.toolVersion !== '1.0.0') invalid();
    const data = tool.outputSchema.properties;
    const rawOperation = record(rawManifest) && Array.isArray(rawManifest.operations)
      ? rawManifest.operations[index] : undefined;
    const structuredSchema = record(rawOperation) && record(rawOperation.response)
      ? rawOperation.response.structuredOutputSchema : undefined;
    if (!record(data) || !record(data.Data) || !record(data.Data.properties) ||
        !record(data.Data.properties.TimeRange) ||
        JSON.stringify(data.Data.properties.TimeRange.enum) !== JSON.stringify([wirePeriods[index]]) ||
        !schemaTreeMatches(structuredSchema, tool.outputSchema) ||
        !record(tool.outputSchema['x-assistant-result-policy']) ||
        !isDeepStrictEqual(tool.outputSchema['x-assistant-result-policy'].allowedFieldPaths,
          ['Data', 'Data.TimeRange']) ||
        !isDeepStrictEqual(tool.outputSchema['x-assistant-result-policy'].deniedFieldPaths, []) ||
        !isDeepStrictEqual(tool.outputSchema['x-assistant-result-policy'].permissionMasks, [])) invalid();
  }
  return tools as CatalogTool[];
}

export async function runLocalKpiProvisioning(
  db: PrismaClient, mode: Mode, verifyBackend: () => Promise<VerifiedBackend> = verifyCurrentManagedBackend
) {
  const tools = loadLocalKpiCatalog();
  const backend = mode === 'activate' || mode === 'verify-demo' ? await verifyBackend() : undefined;
  return db.$transaction(async (tx) => {
    if (mode === 'activate' || mode === 'verify-demo') {
      const migrations = await tx.$queryRaw<Array<{ migration_name: string }>>`
        SELECT migration_name FROM "_prisma_migrations"
        WHERE migration_name IN (
          '20261028000000_assistant_session_integration_ownership',
          '20261029000000_assistant_session_integration_whitespace_check'
        ) AND finished_at IS NOT NULL AND rolled_back_at IS NULL`;
      if (migrations.length !== 2) invalid();
      // The managed process start is verified against its PID, listening port and compiled configuration.
      // Old NULL Sessions remain inaccessible; only a NULL created by this verified runtime blocks activation.
      const unsafeNewSessions = await tx.$queryRaw<Array<{ count: number }>>`
        SELECT COUNT(*)::integer AS count FROM "AssistantSession"
        WHERE "integrationId" IS NULL
          AND "createdAt" >= (${backend!.startedAt.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
      if (unsafeNewSessions[0]?.count !== 0) invalid();
    }
    const customer = await tx.customer.findUnique({ where: { id: customerId }, select: { id: true } });
    const binding = await tx.integrationBinding.findUnique({ where: { integrationId },
      select: { customerId: true, allowedHostApp: true, enabled: true } });
    const bindings = await tx.integrationBinding.findMany({ where: { customerId, enabled: true },
      select: { integrationId: true } });
    if (!customer || !binding?.enabled || binding.customerId !== customerId || binding.allowedHostApp !== hostApp ||
        bindings.length !== 1 || bindings[0]?.integrationId !== integrationId) invalid();

    const definitions = await tx.toolDefinition.findMany({ where: { name: { in: [...c01Keys, ...demoKeys] }, version: '1.0.0' },
      include: { customerPolicies: { where: { customerId } } } });
    const byName = new Map(definitions.map((definition) => [definition.name, definition]));
    if (c01Keys.some((key) => !byName.get(key)?.isActive || !byName.get(key)?.customerPolicies[0])) invalid();
    for (const tool of tools) {
      const existing = byName.get(tool.name);
      if (existing && (!existing.isActive || existing.operation !== ToolOperation.read || existing.hasSideEffect ||
          existing.description !== tool.description || existing.resource !== tool.resource ||
          existing.riskLevel !== RiskLevel.low || existing.requiresApproval || existing.requiresConfirmation ||
          existing.connectorKey !== 'business' || existing.timeoutMs !== tool.timeoutMs ||
          !isDeepStrictEqual(existing.inputSchema, tool.inputSchema) ||
          !isDeepStrictEqual(existing.outputSchema, tool.outputSchema) ||
          !isDeepStrictEqual(existing.requiredPermissions, tool.requiredPermissions))) invalid();
    }
    const current = (keys: readonly string[]) => keys.map((key) => {
      const definition = byName.get(key);
      return { key, registered: !!definition, enabled: definition?.customerPolicies[0]?.enabled === true };
    });
    if (mode === 'dry-run') return { mode, customerId, integrationId, c01: current(c01Keys), demo: current(demoKeys) };

    if (mode === 'verify-default') {
      if (c01Keys.some((key) => byName.get(key)?.customerPolicies[0]?.enabled !== true) ||
          demoKeys.some((key) => byName.get(key)?.customerPolicies[0]?.enabled === true)) invalid();
      return { mode, customerId, integrationId, c01Enabled: 3, demoEnabled: 0 };
    }

    if (mode === 'prepare') {
      if (c01Keys.some((key) => byName.get(key)?.customerPolicies[0]?.enabled !== true) ||
          demoKeys.some((key) => byName.get(key)?.customerPolicies[0]?.enabled)) invalid();
      for (const tool of tools) {
        const definition = byName.get(tool.name) ?? await tx.toolDefinition.create({ data: {
          name: tool.name, version: tool.version, description: tool.description, resource: tool.resource,
          operation: ToolOperation.read, inputSchema: tool.inputSchema as Prisma.InputJsonValue,
          outputSchema: tool.outputSchema as Prisma.InputJsonValue,
          requiredPermissions: tool.requiredPermissions, riskLevel: RiskLevel.low, hasSideEffect: false,
          requiresConfirmation: false, requiresApproval: false, connectorKey: 'business', timeoutMs: tool.timeoutMs,
          isActive: true
        } });
        await tx.customerToolPolicy.upsert({
          where: { customerId_toolDefinitionId: { customerId, toolDefinitionId: definition.id } },
          create: { customerId, toolDefinitionId: definition.id, enabled: false,
            requiredRoles: [], requiredPermissionScopes: [] }, update: {}
        });
      }
    } else {
      if (demoKeys.some((key) => !byName.get(key)?.customerPolicies[0] ||
          byName.get(key)?.customerPolicies[0]?.requiredRoles.length !== 0 ||
          byName.get(key)?.customerPolicies[0]?.requiredPermissionScopes.length !== 0)) invalid();
      const targetDemo = mode === 'activate' || mode === 'verify-demo';
      const expected = [...c01Keys.map((key) => ({ key, enabled: !targetDemo })),
        ...demoKeys.map((key) => ({ key, enabled: targetDemo }))];
      if (mode.startsWith('verify')) {
        if (expected.some(({ key, enabled }) => byName.get(key)?.customerPolicies[0]?.enabled !== enabled)) invalid();
      } else {
        const c01Enabled = c01Keys.map((key) => byName.get(key)?.customerPolicies[0]?.enabled);
        const demoEnabled = demoKeys.map((key) => byName.get(key)?.customerPolicies[0]?.enabled);
        const allC01 = c01Enabled.every(Boolean) && demoEnabled.every((value) => !value);
        const allDemo = demoEnabled.every(Boolean) && c01Enabled.every((value) => !value);
        if (!allC01 && !allDemo) invalid();
        for (const { key, enabled } of expected) {
          const definition = byName.get(key)!;
          await tx.customerToolPolicy.update({
            where: { customerId_toolDefinitionId: { customerId, toolDefinitionId: definition.id } },
            data: { enabled }
          });
        }
      }
    }
    return { mode, customerId, integrationId, c01Enabled: mode === 'activate' || mode === 'verify-demo' ? 0 : 3,
      demoEnabled: mode === 'activate' || mode === 'verify-demo' ? 3 : 0 };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

/** The local manager's recorded hash proves the running PID loaded the current compiled tree. */
export async function verifyCurrentManagedBackend(): Promise<VerifiedBackend> {
  const manager = require('../dev/local-assistant/local-lib.mjs') as LocalManager;
  const state: unknown = JSON.parse(readFileSync(manager.STATE_FILE, 'utf8'));
  if (!record(state) || !record(state.services) || !record(state.services.backend)) invalid();
  const backend = state.services.backend;
  if (backend.command !== 'node' || !isDeepStrictEqual(backend.args, [manager.BACKEND_COMPILED_ENTRYPOINT]) ||
      backend.port !== 3000 || typeof backend.pid !== 'number' || !Number.isSafeInteger(backend.pid) ||
      typeof backend.configHash !== 'string' || typeof backend.startedAt !== 'string') invalid();
  const startedAt = new Date(backend.startedAt);
  if (!Number.isFinite(startedAt.getTime()) || startedAt.getTime() > Date.now() || manager.portOwner(3000) !== backend.pid) invalid();
  const processInfo = spawnSync('ps', ['-p', String(backend.pid), '-o', 'lstart=', '-o', 'command='], { encoding: 'utf8' });
  if (processInfo.status !== 0 || typeof processInfo.stdout !== 'string') invalid();
  const match = processInfo.stdout.trim().match(/^(.{24})\s+node dist\/src\/main\.js$/);
  if (!match) invalid();
  const processStartedAt = new Date(match[1]);
  if (!Number.isFinite(processStartedAt.getTime()) ||
      startedAt.getTime() - processStartedAt.getTime() < 0 ||
      startedAt.getTime() - processStartedAt.getTime() > 10_000) invalid();
  const rootEnv = manager.readEnvFile(join(manager.ROOT, '.env'));
  const backendEnv = manager.readEnvFile(join(manager.ROOT, '.local-secrets/connector-local/backend.env'));
  let packPaths: unknown;
  try { packPaths = JSON.parse(backendEnv.ASSISTANT_CAPABILITY_PACK_PATHS_JSON); } catch { invalid(); }
  if (!Array.isArray(packPaths) || packPaths.length === 0 ||
      packPaths.some((path) => typeof path !== 'string' || !existsSync(path))) invalid();
  const configInputs = [join(manager.ROOT, '.env'), join(manager.ROOT, '.local-secrets/connector-local/backend.env'),
    ...packPaths, join(manager.ROOT, manager.BACKEND_COMPILED_ENTRYPOINT),
    ...manager.compiledFiles(join(manager.ROOT, 'dist/src'))];
  if (manager.hashFilesAndValues(configInputs, { command: 'node', args: [manager.BACKEND_COMPILED_ENTRYPOINT], port: 3000 }) !==
      backend.configHash) invalid();
  if ((backendEnv.NODE_ENV ?? rootEnv.NODE_ENV) !== 'development') invalid();
  const response = await fetch('http://127.0.0.1:3000/api/v1/health', { signal: AbortSignal.timeout(1500) });
  if (!response.ok) invalid();
  return { startedAt: processStartedAt };
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function schemaTreeMatches(source: unknown, target: unknown): boolean {
  if (!record(source) || !record(target) || source.type !== target.type) return false;
  if (source.type !== 'object') return true;
  if (source.additionalProperties !== false || target.additionalProperties !== false ||
      !isDeepStrictEqual(source.required, target.required) ||
      !record(source.properties) || !record(target.properties)) return false;
  const sourceProperties = source.properties;
  const targetProperties = target.properties;
  const sourceKeys = Object.keys(sourceProperties).sort();
  if (!isDeepStrictEqual(sourceKeys, Object.keys(targetProperties).sort())) return false;
  return sourceKeys.every((key) => schemaTreeMatches(sourceProperties[key], targetProperties[key]));
}
function invalid(): never { throw new Error('Shinmone local KPIStats provisioning contract rejected.'); }

function localDatabaseUrl(raw: string | undefined): string {
  if (!raw) invalid();
  const url = new URL(raw);
  if (url.protocol !== 'postgresql:' || !['localhost', '127.0.0.1', '::1'].includes(url.hostname) ||
      !/^assistant_(?:dev|kpistats_[a-z0-9_]+)$/.test(url.pathname.slice(1))) invalid();
  return raw;
}

async function main() {
  const [flag, extra] = process.argv.slice(2);
  const mode = flag?.replace(/^--/, '') as Mode;
  if (!['dry-run', 'prepare', 'activate', 'rollback', 'verify-demo', 'verify-c01', 'verify-default'].includes(mode) ||
      !!extra || process.argv.length !== 3) invalid();
  const db = createPrismaClient(localDatabaseUrl(process.env.DATABASE_URL));
  try { process.stdout.write(`${JSON.stringify(await runLocalKpiProvisioning(db, mode))}\n`); }
  finally { await db.$disconnect(); }
}

if (require.main === module) void main().catch(() => { process.stderr.write('Local KPIStats provisioning rejected.\n'); process.exitCode = 1; });
