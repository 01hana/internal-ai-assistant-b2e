import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Phase 2A readiness production composition', () => {
  it('uses Feature 005 active-only repositories and the Feature 004 trust-profile read path', () => {
    const source = readFileSync(resolve(__dirname, '../../src/managed-identity-exchange/persistence/managed-exchange-readiness.composition.ts'), 'utf8');
    expect(source).toMatch(/findEnabledActiveByIntegrationId/);
    expect(source).toMatch(/findEnabledActiveById/);
    expect(source).toMatch(/findEnabledActiveByConfigId/);
    expect(source).toMatch(/findEnabledActive\(\)/);
    expect(source).toMatch(/findEnabledActiveSigningKeysByIssuerId/);
    expect(source).toMatch(/trustProfiles\.findEnabledActiveByIntegrationId/);
    expect(source).not.toMatch(/\.create\(|\.update\(|\.replace\(/);
  });
});
