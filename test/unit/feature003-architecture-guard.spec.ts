import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const repositoryRoot = resolve(__dirname, '../..');
const gatewaySourceRoot = join(repositoryRoot, 'apps/gateway/src');

describe('Feature 003 architecture guardrails', () => {
  it('keeps Backend and Gateway runtime source trees independent when Gateway source is introduced', () => {
    const backendSource = readSourceFiles(join(repositoryRoot, 'src'));
    const gatewaySource = readSourceFiles(gatewaySourceRoot);

    expect(backendSource.filter(({ content }) => /(?:from|require\()\s*['"][^'"]*apps\/gateway(?:\/src)?\//.test(content))).toEqual([]);
    expect(gatewaySource.filter(({ content }) => /(?:from|require\()\s*['"](?:\.\.\/)+src\//.test(content))).toEqual([]);
  });

  it('keeps the root Prisma schema as the only Customer-root and migration lineage', () => {
    const schema = readFileSync(join(repositoryRoot, 'prisma/schema.prisma'), 'utf8');

    expect(schema.match(/^model Customer\s*\{/gm)).toHaveLength(1);
    expect(existsSync(join(repositoryRoot, 'apps/gateway/prisma/schema.prisma'))).toBe(false);
    expect(existsSync(join(repositoryRoot, 'apps/gateway/prisma/migrations'))).toBe(false);
  });

  it('rejects generic proxy and Feature 004 capability runtime surface in Gateway source without requiring Gateway source to exist yet', () => {
    const gatewaySource = readSourceFiles(gatewaySourceRoot);
    const forbidden = /@All\s*\(|@Controller\s*\(\s*['"`]\*|HostAppRegistryService|HostPageContextPolicyService|HostInteractionEligibilityService|DataAdapter(?:RegistryService|EvidenceResult)?|AdminOrdersAdapter|AdminInventoryAdapter|sourceSystem/;

    expect(gatewaySource.filter(({ content }) => forbidden.test(content))).toEqual([]);
  });

  it('keeps Phase 4 canonical resolution isolated from Customer inference, business audit, signing, JWKS, and Backend transport', () => {
    const resolverPath = join(gatewaySourceRoot, 'integration-registry', 'canonical-identity-resolver.service.ts');
    const composerPath = join(gatewaySourceRoot, 'identity', 'canonical-gateway-identity.ts');
    expect(existsSync(resolverPath)).toBe(true);
    expect(existsSync(composerPath)).toBe(true);

    const source = `${readFileSync(resolverPath, 'utf8')}\n${readFileSync(composerPath, 'utf8')}`;
    expect(source).toMatch(/findByIntegrationId/);
    expect(source).not.toMatch(/findCustomerByOrganizationId|findCustomerBySubject|findCustomerByHostApp|findDefaultCustomer|findFirstEnabledCustomer/);
    expect(source).not.toMatch(/AuditWriterService|src\/audit|SigningKeyProvider|GatewaySigningKey|InternalIdentityTokenIssuer|GatewayBackendClient|BackendRouteDefinition|jwks/i);
  });
});

function readSourceFiles(root: string): Array<{ path: string; content: string }> {
  if (!existsSync(root)) return [];

  const files: string[] = [];
  collectSourceFiles(root, files);
  return files.map((path) => ({ path, content: readFileSync(path, 'utf8') }));
}

function collectSourceFiles(directory: string, files: string[]): void {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      collectSourceFiles(path, files);
    } else if (/\.(?:ts|tsx|js|cjs|mjs)$/.test(path)) {
      files.push(path);
    }
  }
}
