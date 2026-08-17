import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repositoryRoot = resolve(__dirname, '../../../..');
const environmentPath = resolve(repositoryRoot, '.env.example');
const readmePath = resolve(repositoryRoot, 'README.md');

describe('Profile-only runtime deployment guidance (T045)', () => {
  it('marks legacy upstream values as commented bootstrap-only inputs and retains runtime clock tolerance', () => {
    const environment = readFileSync(environmentPath, 'utf8');

    expect(environment).toMatch(/GATEWAY_UPSTREAM_JWT_CLOCK_TOLERANCE_SECONDS=0/);
    expect(environment).toMatch(/0\.\.300 seconds/);
    expect(environment).toMatch(/Optional bootstrap-only migration inputs/);
    for (const name of legacyNames) {
      expect(environment).toMatch(new RegExp(`^# ${name}=`, 'm'));
      expect(environment).not.toMatch(new RegExp(`^${name}=`, 'm'));
    }
  });

  it('documents profile-only fail-closed runtime and explicit bootstrap anchoring without fallback language', () => {
    const readme = readFileSync(readmePath, 'utf8');

    expect(readme).toMatch(/Gateway Profile-only Upstream Trust/);
    expect(readme).toMatch(/Runtime startup fails closed/);
    expect(readme).toMatch(/bootstrap-only migration inputs/);
    expect(readme).toMatch(/never a verifier fallback/);
    expect(readme).toMatch(/explicitly\s+supply its `integrationId`/);
    expect(readme).toMatch(/Gateway startup never invokes\s+it automatically/);
    expect(readme).toMatch(/sole Customer and HostApp admission authority/);
    expect(readme).toMatch(/30-second default and 60-second maximum TTL/);
    expect(readme).not.toMatch(/legacy[^\n]{0,80}(?:required runtime verifier|runtime fallback)/i);
  });

  it('keeps legacy configuration names out of active runtime authority surfaces', () => {
    for (const relativePath of runtimePaths) {
      const source = readFileSync(resolve(repositoryRoot, relativePath), 'utf8');
      for (const name of legacyNames) expect(source).not.toContain(name);
    }
  });
});

const legacyNames = [
  'GATEWAY_UPSTREAM_JWT_ISSUER',
  'GATEWAY_UPSTREAM_JWT_AUDIENCE',
  'GATEWAY_UPSTREAM_JWKS_URI'
];

const runtimePaths = [
  'apps/gateway/src/gateway.module.ts',
  'apps/gateway/src/upstream-auth/multi-profile-upstream-token-verifier.ts',
  'apps/gateway/src/upstream-auth/profile-scoped-verifier.ts',
  'apps/gateway/src/integration-registry/candidate-trust-profile.resolver.ts',
  'apps/gateway/src/integration-registry/trust-profile-cache.ts',
  'apps/gateway/src/backend-client/gateway-trust-chain.handler.ts'
];
