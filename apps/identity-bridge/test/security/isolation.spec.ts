import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { BridgeReadinessRegistry } from '../../src/health/readiness.service';

const bridgeRoot = join(__dirname, '../..');
const sourceRoot = join(bridgeRoot, 'src');

describe('Feature 007 multi-deployment architecture guard', () => {
  const sources = sourceFiles(sourceRoot).map((file) => readFileSync(file, 'utf8')).join('\n');

  it('contains no central authority, persistence, selector, or Customer registry responsibility', () => {
    expect(sources).not.toMatch(/IntegrationBinding|CustomerScope|CustomerRepository|CustomerRegistry|ManagedIdentityExchangeModule|ManagedUpstreamTokenIssuer|GatewaySigning|InternalIdentityTokenIssuer|integrationSelector|@prisma|PrismaClient/);
    expect(sources).not.toMatch(/currentCustomer|currentIntegration|currentEntry|currentSigningKey|currentHostApp|customerRegistry|customerMap/i);
    const packageJson = readFileSync(join(bridgeRoot, 'package.json'), 'utf8');
    expect(packageJson).not.toMatch(/@prisma|apps\/gateway|managed-identity-exchange/i);
  });

  it('contains no source-coded deployment branch or synthetic deployment identifier', () => {
    expect(sources).not.toMatch(/\bif\s*\([^)]*(?:customer|integrationId|hostApp|allowedEntry|idxMenuDetailUri|issuer|audience)[^)]*===\s*['"][^'"]+['"]/i);
    expect(sources).not.toMatch(/\bswitch\s*\([^)]*(?:customer|integrationId|hostApp|allowedEntry|idxMenuDetailUri|issuer|audience)[^)]*\)/i);
    expect(sources).not.toMatch(/idx-[ab]\.example\.test|entry-[ab]|integration-[ab]|host-[ab]|issuer-[ab]\.example\.test|audience-[ab]|kid-[ab]|company-[ab]|user-[ab]/i);
  });

  it('keeps Phase 8 outside runtime readiness and Phase 9 absent', () => {
    expect(new BridgeReadinessRegistry().snapshot()).toEqual({ idxTransport: false, idxSemantics: false, signing: false, jwks: false, exchange: false });
    expect(sources).not.toMatch(/multiDeploymentIsolation|deploymentIsolationReady/i);
    expect(existsSync(join(bridgeRoot, '../gateway/test/identity-bridge/bridge-jwks.fixture.ts'))).toBe(false);
    expect(existsSync(join(bridgeRoot, '../gateway/test/identity-bridge/feature007-compatibility.spec.ts'))).toBe(false);
  });
});

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(target);
    return entry.isFile() && entry.name.endsWith('.ts') ? [target] : [];
  }).sort();
}
