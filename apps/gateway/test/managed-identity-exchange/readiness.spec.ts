import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Managed exchange readiness contract (T011)', () => {
  it('provides a read-only, fail-closed readiness validator', () => {
    const path = resolve(__dirname, '../../src/managed-identity-exchange/persistence/managed-exchange-readiness.validator.ts');
    expect(existsSync(path)).toBe(true);
    const source = existsSync(path) ? require('node:fs').readFileSync(path, 'utf8') : '';
    expect(source).toMatch(/class ManagedExchangeReadinessValidator/);
    expect(source).not.toMatch(/\.create\(|\.update\(|\.delete\(|nativeCredential|customerId|GatewaySigningKeyRepository/);
  });
});
