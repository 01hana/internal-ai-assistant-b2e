import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

type PackageManifest = {
  name?: unknown;
  workspaces?: unknown;
  dependencies?: Record<string, unknown>;
  devDependencies?: Record<string, unknown>;
  optionalDependencies?: Record<string, unknown>;
  peerDependencies?: Record<string, unknown>;
};

const root = process.cwd();
const gatewayRoot = join(root, 'apps', 'gateway');
const contractRoot = join(root, 'packages', 'internal-identity-contract');
const dependencySections = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'] as const;

describe('Feature 003 package and runtime architecture', () => {
  const rootManifest = readManifest(join(root, 'package.json'));
  const gatewayManifest = readManifest(join(gatewayRoot, 'package.json'));
  const contractManifest = readManifest(join(contractRoot, 'package.json'));

  it('keeps the repository outside npm workspaces, TypeScript paths, and project references', () => {
    expect(rootManifest.workspaces).toBeUndefined();

    const rootTsConfig = readFileSync(join(root, 'tsconfig.json'), 'utf8');
    expect(rootTsConfig).not.toMatch(/"paths"\s*:/);
    expect(rootTsConfig).not.toMatch(/"references"\s*:/);
  });

  it('permits only the pure local contract package as Gateway local runtime vocabulary', () => {
    expect(validateGatewayManifestBoundary(rootManifest, gatewayManifest, contractManifest)).toEqual([]);
  });

  it('rejects a synthetic Gateway dependency on the actual Backend package through the repository root', () => {
    const rootPackageName = requirePackageName(rootManifest, 'root');
    const invalidGatewayManifest: PackageManifest = {
      ...gatewayManifest,
      dependencies: { ...gatewayManifest.dependencies, [rootPackageName]: 'file:../..' }
    };

    expect(validateGatewayManifestBoundary(rootManifest, invalidGatewayManifest, contractManifest)).toEqual(
      expect.arrayContaining([expect.stringContaining(`dependencies.${rootPackageName}`)])
    );
  });

  it('rejects a synthetic local dependency that points at Backend source', () => {
    const invalidGatewayManifest: PackageManifest = {
      ...gatewayManifest,
      devDependencies: { ...gatewayManifest.devDependencies, 'synthetic-backend-source': 'file:../../src' }
    };

    expect(validateGatewayManifestBoundary(rootManifest, invalidGatewayManifest, contractManifest)).toEqual(
      expect.arrayContaining([expect.stringContaining('devDependencies.synthetic-backend-source')])
    );
  });

  it('keeps root Prisma as the only schema and migration authority', () => {
    expect(existsSync(join(root, 'prisma', 'schema.prisma'))).toBe(true);
    expect(existsSync(join(gatewayRoot, 'prisma', 'schema.prisma'))).toBe(false);
    expect(existsSync(join(gatewayRoot, 'prisma', 'migrations'))).toBe(false);
    expect(readFileSync(join(root, 'prisma', 'schema.prisma'), 'utf8').match(/^model Customer\b/gm)).toHaveLength(1);
  });

  it('prohibits Backend-to-Gateway and Gateway-to-Backend runtime imports', () => {
    const rootPackageName = requirePackageName(rootManifest, 'root');
    const backendSource = readTree(join(root, 'src'), new Set([join(root, 'src', 'generated')]));
    const gatewaySource = existsSync(join(gatewayRoot, 'src')) ? readTree(join(gatewayRoot, 'src')) : '';
    const rootPackageImport = escapeRegularExpression(rootPackageName);

    expect(backendSource).not.toMatch(/apps\/gateway\/src|@internal-ai-assistant\/gateway|gateway\.module/i);
    expect(gatewaySource).not.toMatch(/(?:from\s+['"][^'"]*(?:\.\.\/){2,}src\/|require\(['"][^'"]*(?:\.\.\/){2,}src\/)/);
    expect(gatewaySource).not.toMatch(
      new RegExp(`(?:from\\s+['"]${rootPackageImport}['"]|require\\(\\s*['"]${rootPackageImport}['"]\\s*\\)|import\\(\\s*['"]${rootPackageImport}['"]\\s*\\))`)
    );
  });
});

function validateGatewayManifestBoundary(
  rootManifest: PackageManifest,
  gatewayManifest: PackageManifest,
  contractManifest: PackageManifest
): string[] {
  const rootPackageName = requirePackageName(rootManifest, 'root');
  const contractPackageName = requirePackageName(contractManifest, 'shared contract');
  const expectedContractTarget = resolve(gatewayRoot, '../../packages/internal-identity-contract');
  const violations: string[] = [];

  for (const section of dependencySections) {
    for (const [dependencyName, dependencySpec] of Object.entries(gatewayManifest[section] ?? {})) {
      if (dependencyName === rootPackageName) {
        violations.push(`${section}.${dependencyName} may not reference the Backend runtime package.`);
      }

      if (typeof dependencySpec !== 'string' || !dependencySpec.startsWith('file:')) continue;
      const target = resolve(gatewayRoot, dependencySpec.slice('file:'.length));
      const isExactContractDependency =
        dependencyName === contractPackageName && dependencySpec === 'file:../../packages/internal-identity-contract' && target === expectedContractTarget;
      if (isExactContractDependency) continue;

      const targetDescription = relative(root, target) || '.';
      violations.push(`${section}.${dependencyName} has forbidden local file target ${targetDescription}.`);
    }
  }

  return violations;
}

function readManifest(path: string): PackageManifest {
  return JSON.parse(readFileSync(path, 'utf8')) as PackageManifest;
}

function requirePackageName(manifest: PackageManifest, label: string): string {
  if (typeof manifest.name !== 'string' || manifest.name.trim() === '') {
    throw new Error(`Expected ${label} package manifest to define a name.`);
  }
  return manifest.name;
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readTree(directory: string, excludedDirectories = new Set<string>()): string {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const entryPath = join(directory, entry.name);
      if (entry.isDirectory()) return excludedDirectories.has(entryPath) ? [] : readTree(entryPath, excludedDirectories);
      return entry.name.endsWith('.ts') || entry.name.endsWith('.json') ? [readFileSync(entryPath, 'utf8')] : [];
    })
    .join('\n');
}
