import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const bridgeRoot = join(__dirname, '..');

describe('Identity Bridge independent package contract', () => {
  it('is an independently buildable Nest package with no Gateway, database, or central signing-authority dependency', () => {
    const manifestPath = join(bridgeRoot, 'package.json');
    expect(existsSync(manifestPath)).toBe(true);

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { scripts?: Record<string, string>; dependencies?: Record<string, string> };
    expect(manifest.scripts).toMatchObject({ test: expect.any(String), build: expect.any(String) });
    const dependencies = Object.keys(manifest.dependencies ?? {}).join('\n');
    const forbiddenDependency = /prisma|internal-identity-contract|gateway|managed-identity-exchange/i;
    expect(dependencies).not.toMatch(forbiddenDependency);
    expect('jose').not.toMatch(forbiddenDependency);
  });

  it('does not compose Gateway runtime, persistence, managed exchange, or signing sources', () => {
    const sourceRoot = join(bridgeRoot, 'src');
    expect(existsSync(sourceRoot)).toBe(true);
    const source = readTree(sourceRoot);
    expect(source).not.toMatch(/apps\/gateway|GatewayModule|ManagedIdentityExchangeModule|generated\/prisma|@prisma|GatewaySigning|InternalIdentityTokenIssuer/i);
  });
});

function readTree(path: string): string {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const target = join(path, entry.name);
    return entry.isDirectory() ? [readTree(target)] : entry.name.endsWith('.ts') ? [readFileSync(target, 'utf8')] : [];
  }).join('\n');
}
