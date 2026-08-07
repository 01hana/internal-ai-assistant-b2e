export function assertSafeTestDatabaseReset(env: Record<string, string | undefined>) {
  if (env.NODE_ENV !== 'test') {
    throw new Error('Refusing to reset database: NODE_ENV must be "test".');
  }

  if (env.ALLOW_TEST_DB_RESET !== 'true') {
    throw new Error('Refusing to reset database: ALLOW_TEST_DB_RESET=true is required.');
  }

  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('Refusing to reset database: DATABASE_URL is required.');
  }

  let databaseName: string;
  try {
    databaseName = new URL(databaseUrl).pathname.replace(/^\//, '');
  } catch {
    throw new Error('Refusing to reset database: DATABASE_URL must be a valid URL.');
  }

  if (!databaseName) {
    throw new Error('Refusing to reset database: DATABASE_URL must include a database name.');
  }

  if (databaseName !== 'assistant_test' && !databaseName.endsWith('_test')) {
    throw new Error(`Refusing to reset database: database "${databaseName}" is not an allowed test database.`);
  }
}
