// Create the first local back-office account (Feature 014) with the same environment `npm run local:start`
// gives the admin API, so no ADMIN_* values need to be typed. Runs the compiled CLI from the local build,
// like `deploy.sh admin-bootstrap` does in the image; the first-login link is printed once.
//   npm run admin:local:bootstrap -- --account <account> --name <name> --email <email>
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { LocalAssistantError, ROOT, hostDatabaseUrl, localAdminEnvironment, readEnvFile } from './local-lib.mjs';

const CLI = 'dist/src/admin/bootstrap/admin-bootstrap.cli.js';

try {
  if (!existsSync(join(ROOT, CLI))) throw new LocalAssistantError('LOCAL_ENV_INVALID', `Missing ${CLI}; run npm run local:start (or npm run build) first.`);
  const rootEnv = readEnvFile(join(ROOT, '.env'));
  const backendEnv = { ...rootEnv, ...readEnvFile(join(ROOT, '.local-secrets/connector-local/backend.env')) };
  const environment = localAdminEnvironment(rootEnv, backendEnv, hostDatabaseUrl(rootEnv.DATABASE_URL));
  const result = spawnSync('node', [CLI, ...process.argv.slice(2)], { cwd: ROOT, env: { ...process.env, ...environment }, stdio: 'inherit' });
  process.exitCode = result.status ?? 1;
} catch (error) {
  process.stderr.write(`${error instanceof LocalAssistantError ? error.message : 'Local admin bootstrap failed.'}\n`);
  process.exitCode = 1;
}
