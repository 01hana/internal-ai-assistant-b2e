import { config as loadEnv } from 'dotenv';
import { PrismaClient } from '../../src/generated/prisma/client';
import { createPrismaClient } from '../../src/prisma/prisma-client.factory';

loadEnv({ path: '.env.test', override: true });
loadEnv();

export function createUs1DbClient(): PrismaClient {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required for DB-backed US1 tests.');
  }

  assertTestDatabaseUrl(databaseUrl);

  return createPrismaClient(databaseUrl);
}

export const describeDbBackedUs1 =
  process.env.RUN_DB_BACKED_US1_TESTS === 'true' ? describe : describe.skip;

function assertTestDatabaseUrl(databaseUrl: string) {
  let databaseName: string;
  try {
    databaseName = new URL(databaseUrl).pathname.replace(/^\//, '');
  } catch {
    throw new Error('DATABASE_URL must be a valid URL for DB-backed US1 tests.');
  }

  if (databaseName !== 'assistant_test' && !databaseName.endsWith('_test')) {
    throw new Error(`DATABASE_URL must point to a test database for DB-backed US1 tests, received "${databaseName}".`);
  }
}
