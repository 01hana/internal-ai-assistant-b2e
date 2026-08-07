import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { assertSafeTestDatabaseReset } from '../../scripts/test-db-safety';

loadEnv({ path: '.env.test', override: true, quiet: true });
loadEnv({ quiet: true });

const execFile = promisify(execFileCallback);
const MIGRATIONS = [
  '20260615044944_init/migration.sql',
  '20260621000000_add_escalation_expired_status/migration.sql',
  '20260804000000_customer_scope_expand/migration.sql',
  '20260804000001_customer_scope_backfill_enforce/migration.sql'
] as const;

let databaseCounter = 0;

export type CustomerMigrationDatabase = Readonly<{
  databaseName: string;
  databaseUrl: string;
  applyThroughReleaseA(): Promise<void>;
  applyReleaseB(): Promise<void>;
  applyAllMigrations(): Promise<void>;
  execute(sql: string): Promise<void>;
  scalar(sql: string): Promise<string>;
  dispose(): Promise<void>;
}>;

export async function createCustomerMigrationDatabase(label: string): Promise<CustomerMigrationDatabase> {
  const configuredUrl = process.env.DATABASE_URL;
  if (!configuredUrl) throw new Error('DATABASE_URL is required for Customer migration database tests.');

  const configured = new URL(configuredUrl);
  const databaseName = `phase9_${safeLabel(label)}_${process.pid}_${Date.now()}_${databaseCounter++}_test`;
  const databaseUrl = new URL(configured);
  databaseUrl.pathname = `/${databaseName}`;
  assertSafeTestDatabaseReset({ ...process.env, DATABASE_URL: databaseUrl.toString() });

  const cliDatabaseUrl = postgresCliUrl(databaseUrl);
  const adminUrl = postgresCliUrl(configured);
  adminUrl.pathname = '/postgres';
  await run('createdb', [`--maintenance-db=${adminUrl.toString()}`, databaseName]);

  let disposed = false;
  const execute = async (sql: string): Promise<void> => {
    await run('psql', ['--dbname', cliDatabaseUrl.toString(), '--set', 'ON_ERROR_STOP=1', '--command', sql]);
  };
  const scalar = async (sql: string) => {
    const output = await run('psql', ['--dbname', cliDatabaseUrl.toString(), '--tuples-only', '--no-align', '--set', 'ON_ERROR_STOP=1', '--command', sql]);
    return output.trim();
  };
  const applyMigration = async (index: number) => {
    await run('psql', ['--dbname', cliDatabaseUrl.toString(), '--set', 'ON_ERROR_STOP=1', '--file', migrationFile(MIGRATIONS[index])]);
  };

  return Object.freeze({
    databaseName,
    databaseUrl: databaseUrl.toString(),
    async applyThroughReleaseA() {
      for (let index = 0; index < 3; index += 1) await applyMigration(index);
    },
    async applyReleaseB() {
      await applyMigration(3);
    },
    async applyAllMigrations() {
      for (let index = 0; index < MIGRATIONS.length; index += 1) await applyMigration(index);
    },
    execute,
    scalar,
    async dispose() {
      if (disposed) return;
      disposed = true;
      await run('dropdb', ['--maintenance-db', adminUrl.toString(), '--force', databaseName]);
    }
  });
}

export async function resetConfiguredTestDatabaseSchema(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required to reset and migrate the test database.');
  assertSafeTestDatabaseReset(process.env);
  const configured = new URL(databaseUrl);
  const databaseName = configured.pathname.replace(/^\//, '');
  const adminUrl = postgresCliUrl(configured);
  adminUrl.pathname = '/postgres';
  await run('dropdb', ['--maintenance-db', adminUrl.toString(), '--force', databaseName]);
  await run('createdb', [`--maintenance-db=${adminUrl.toString()}`, databaseName]);
  await run('npx', ['prisma', 'migrate', 'deploy'], { ...process.env, DATABASE_URL: databaseUrl });
}

export async function runTestDatabaseInitialization(): Promise<void> {
  assertSafeTestDatabaseReset(process.env);
  await run('npm', ['run', 'test:db:init'], process.env);
}

function migrationFile(name: string): string {
  return resolve(__dirname, '../../prisma/migrations', name);
}

function safeLabel(value: string): string {
  return value.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 32) || 'case';
}

function postgresCliUrl(value: URL): URL {
  const result = new URL(value);
  result.searchParams.delete('schema');
  return result;
}

async function run(command: string, argumentsList: readonly string[], environment?: NodeJS.ProcessEnv): Promise<string> {
  try {
    const result = await execFile(command, [...argumentsList], {
      cwd: resolve(__dirname, '../..'),
      env: environment,
      maxBuffer: 2 * 1024 * 1024
    });
    return result.stdout;
  } catch (error) {
    const exitCode = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : 'unknown';
    const stderr = typeof error === 'object' && error !== null && 'stderr' in error ? String(error.stderr).trim() : '';
    throw new Error(`Customer migration test command failed: ${command} (exit ${exitCode}): ${redactConnectionDetails(stderr) || 'no diagnostic output'}`);
  }
}

function redactConnectionDetails(value: string): string {
  return value
    .replace(/postgres(?:ql)?:\/\/[^\s@/]+@/gi, 'postgresql://[redacted]@')
    .replace(/password=[^\s&]+/gi, 'password=[redacted]')
    .slice(0, 800);
}
