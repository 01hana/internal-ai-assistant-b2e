import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const commands = [
  'provision-managed-identity-provider.ts',
  'provision-managed-integration-exchange-config.ts',
  'provision-managed-admission-policy.ts',
  'provision-managed-permission-source.ts',
  'provision-managed-permission-policy.ts',
  'provision-managed-upstream-issuer.ts',
  'provision-managed-upstream-signing-key.ts'
];

describe('Managed exchange control-plane contract (T007–T010)', () => {
  it('exposes direct-only lifecycle commands and never an HTTP controller', () => {
    for (const file of commands) {
      const path = resolve(__dirname, '../../src/commands', file);
      expect(existsSync(path)).toBe(true);
      const source = existsSync(path) ? require('node:fs').readFileSync(path, 'utf8') : '';
      expect(source).not.toMatch(/@Controller|Controller\s*\(/);
    }
  });

  it('exports server-owned validation with no native credential or Customer authority', () => {
    const path = resolve(__dirname, '../../src/managed-identity-exchange/persistence/managed-exchange-activation.validator.ts');
    expect(existsSync(path)).toBe(true);
    const source = existsSync(path) ? require('node:fs').readFileSync(path, 'utf8') : '';
    expect(source).not.toMatch(/from ['"][^'"]*(customer|gateway-signing|canonical-identity-resolver|multi-profile)/i);
    expect(source).toMatch(/ManagedExchangeActivationError/);
  });
});
