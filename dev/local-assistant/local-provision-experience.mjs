// Provision an assistant experience configuration into the local development database (Feature 013).
// The checked-in configuration stays the single source: this command copies it to an ignored file with the
// Customer scope of the local Capability Pack (from the generated .local-secrets/connector-local/backend.env),
// then runs the provisioning CLI with the same environment `npm run local:start` gives the backend.
// The read-only --check runs first; nothing is written unless it passes.
//   npm run assistant-experience:local:provision -- --file customers/<customer>/assistant-experience/<version>.json
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { PORTS, ROOT, STATE_DIR, ensureStateDir, hostDatabaseUrl, readEnvFile } from './local-lib.mjs';

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const args = process.argv.slice(2);
const fileIndex = args.indexOf('--file');
const file = fileIndex >= 0 ? args[fileIndex + 1] : undefined;
if (!file || !existsSync(resolve(ROOT, file))) {
  fail('Usage: npm run assistant-experience:local:provision -- --file <customers/<customer>/assistant-experience/<version>.json>');
}
if (args.includes('--check')) fail('This command always runs --check before writing; do not pass --check.');
const passThrough = args.filter((_value, index) => index !== fileIndex && index !== fileIndex + 1);

const rootEnv = readEnvFile(join(ROOT, '.env'));
const backendEnv = readEnvFile(join(ROOT, '.local-secrets/connector-local/backend.env'));

// The local Customer scope comes from the local Capability Pack whose HostApps cover the configuration's.
const config = JSON.parse(readFileSync(resolve(ROOT, file), 'utf8'));
let packPaths;
try { packPaths = JSON.parse(backendEnv.ASSISTANT_CAPABILITY_PACK_PATHS_JSON ?? '[]'); } catch { packPaths = []; }
if (!Array.isArray(packPaths) || packPaths.length === 0) {
  fail('No local Capability Pack is configured in .local-secrets/connector-local/backend.env; run the local setup first.');
}
const scopes = new Map();
for (const path of packPaths) {
  const pack = JSON.parse(readFileSync(path, 'utf8'));
  const hostApps = Array.isArray(pack.hostApps) ? pack.hostApps : [];
  if (Array.isArray(config.hostApps) && config.hostApps.every((hostApp) => hostApps.includes(hostApp))) {
    scopes.set(`${pack.customerId}\u0000${pack.integrationId}`, { customerId: pack.customerId, integrationId: pack.integrationId });
  }
}
if (scopes.size !== 1) {
  fail(`Expected exactly one local Capability Pack scope for HostApps ${JSON.stringify(config.hostApps)}; found ${scopes.size}.`);
}
const [scope] = scopes.values();
ensureStateDir();
const localFile = join(STATE_DIR, 'assistant-experience.local.json');
writeFileSync(localFile, `${JSON.stringify({ ...config, ...scope }, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`Local scope: ${scope.customerId} / ${scope.integrationId} (from ${file})\n`);

const environment = {
  ...process.env,
  ...rootEnv,
  ...backendEnv,
  // Same identity settings local-start.mjs gives the backend; required by the Core configuration schema.
  INTERNAL_IDENTITY_JWT_ISSUER: rootEnv.GATEWAY_INTERNAL_JWT_ISSUER,
  INTERNAL_IDENTITY_JWT_AUDIENCE: rootEnv.GATEWAY_INTERNAL_JWT_AUDIENCE,
  INTERNAL_IDENTITY_JWKS_URI: `http://127.0.0.1:${PORTS.gateway}/.well-known/jwks.json`,
  DATABASE_URL: hostDatabaseUrl(rootEnv.DATABASE_URL),
};

function run(extra) {
  const result = spawnSync('npx', ['ts-node', '--project', 'tsconfig.scripts.json', 'scripts/provision-assistant-experience.ts',
    '--file', localFile, ...passThrough, ...extra], { cwd: ROOT, env: environment, stdio: 'inherit' });
  return result.status ?? 1;
}

process.stdout.write('== read-only check\n');
if (run(['--check']) !== 0) fail('Check failed; nothing was written.');
process.stdout.write('== write and activate\n');
process.exit(run([]));
