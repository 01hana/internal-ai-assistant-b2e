import { assertSafeTestDatabaseReset } from '../../scripts/test-db-safety';

describe('assertSafeTestDatabaseReset', () => {
  const validEnv = {
    NODE_ENV: 'test',
    ALLOW_TEST_DB_RESET: 'true',
    DATABASE_URL: 'postgresql://postgres:password@127.0.0.1:5435/assistant_test'
  };

  it('accepts the canonical assistant_test database', () => {
    expect(() => assertSafeTestDatabaseReset(validEnv)).not.toThrow();
  });

  it('accepts any database name ending in _test', () => {
    expect(() =>
      assertSafeTestDatabaseReset({
        ...validEnv,
        DATABASE_URL: 'postgresql://postgres:password@127.0.0.1:5435/internal_assistant_test'
      })
    ).not.toThrow();
  });

  it('rejects non-test NODE_ENV', () => {
    expect(() =>
      assertSafeTestDatabaseReset({
        ...validEnv,
        NODE_ENV: 'development'
      })
    ).toThrow('NODE_ENV must be "test"');
  });

  it('rejects missing ALLOW_TEST_DB_RESET=true', () => {
    expect(() =>
      assertSafeTestDatabaseReset({
        ...validEnv,
        ALLOW_TEST_DB_RESET: 'false'
      })
    ).toThrow('ALLOW_TEST_DB_RESET=true is required');
  });

  it('rejects a non-test database URL', () => {
    expect(() =>
      assertSafeTestDatabaseReset({
        ...validEnv,
        DATABASE_URL: 'postgresql://postgres:password@127.0.0.1:5435/assistant_dev'
      })
    ).toThrow('is not an allowed test database');
  });
});
