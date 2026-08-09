import { execFile as execFileCallback } from 'node:child_process';
import { config as loadEnv } from 'dotenv';
import { promisify } from 'node:util';
import { assertSafeTestDatabaseReset } from '../../scripts/test-db-safety';

loadEnv({ path: '.env.test', override: true, quiet: true });

const execFile = promisify(execFileCallback);
let sequence = 0;

export type GatewayRegistryDatabase = Readonly<{
  databaseName: string;
  databaseUrl: string;
  execute(sql: string): Promise<void>;
  scalar(sql: string): Promise<string>;
  dispose(): Promise<void>;
}>;

/** Creates an isolated `_test` database and applies the canonical root migration lineage. */
export async function createGatewayRegistryDatabase(label: string): Promise<GatewayRegistryDatabase> {
  const configuredUrl = process.env.DATABASE_URL;
  if (!configuredUrl) throw new Error('DATABASE_URL is required for Gateway registry database tests.');

  const configured = new URL(configuredUrl);
  const databaseName = `feature003_${safeLabel(label)}_${process.pid}_${Date.now()}_${sequence++}_test`;
  const databaseUrl = new URL(configured);
  databaseUrl.pathname = `/${databaseName}`;
  assertSafeTestDatabaseReset({ ...process.env, DATABASE_URL: databaseUrl.toString() });

  const adminUrl = postgresCliUrl(configured);
  adminUrl.pathname = '/postgres';
  const cliDatabaseUrl = postgresCliUrl(databaseUrl);
  await run('createdb', [`--maintenance-db=${adminUrl.toString()}`, databaseName]);

  try {
    await run('npx', ['prisma', 'migrate', 'deploy'], { ...process.env, DATABASE_URL: databaseUrl.toString() });
  } catch (error) {
    await run('dropdb', ['--maintenance-db', adminUrl.toString(), '--force', databaseName]);
    throw error;
  }

  let disposed = false;
  return Object.freeze({
    databaseName,
    databaseUrl: databaseUrl.toString(),
    execute: (sql) => run('psql', ['--dbname', cliDatabaseUrl.toString(), '--set', 'ON_ERROR_STOP=1', '--command', sql]).then(() => undefined),
    scalar: (sql) => run('psql', ['--dbname', cliDatabaseUrl.toString(), '--tuples-only', '--no-align', '--set', 'ON_ERROR_STOP=1', '--command', sql]).then((output) => output.trim()),
    async dispose() {
      if (disposed) return;
      disposed = true;
      await run('dropdb', ['--maintenance-db', adminUrl.toString(), '--force', databaseName]);
    }
  });
}

function safeLabel(value: string): string {
  return value.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 24) || 'case';
}

function postgresCliUrl(value: URL): URL {
  const result = new URL(value);
  result.searchParams.delete('schema');
  return result;
}

async function run(command: string, argumentsList: readonly string[], environment?: NodeJS.ProcessEnv): Promise<string> {
  try {
    const result = await execFile(command, [...argumentsList], { cwd: process.cwd(), env: environment, maxBuffer: 2 * 1024 * 1024 });
    return result.stdout;
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : 'unknown';
    const stderr = typeof error === 'object' && error !== null && 'stderr' in error ? String(error.stderr).slice(0, 800) : '';
    throw new Error(`Gateway registry test database command failed: ${command} (exit ${code}): ${redact(stderr) || 'no diagnostic output'}`);
  }
}

function redact(value: string): string {
  return value.replace(/postgres(?:ql)?:\/\/[^\s@/]+@/gi, 'postgresql://[redacted]@').replace(/password=[^\s&]+/gi, 'password=[redacted]');
}
