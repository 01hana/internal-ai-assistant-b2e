import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const GENERIC_ROOTS = [
  'packages/connector-runtime-contract/src',
  'src/connectors/productized-business',
  'src/tools',
  'src/query-understanding',
  'apps/customer-connector-runtime/src/bindings',
  'apps/customer-connector-runtime/src/credentials',
  'apps/customer-connector-runtime/src/invocation',
  'apps/customer-connector-runtime/src/manifest',
  'apps/customer-connector-runtime/src/observability',
  'apps/customer-connector-runtime/src/upstream'
];

const REFERENCE_ASSUMPTION = /shinmone|Dashboard\/KPIStats|newOrders|acceptedEntry|nativeAccessToken|MenuDetail|BRIDGE_BINDING_TRANSPORT_V1|這個月新增幾張工單/i;
const GENERIC_CREDENTIAL_ASSUMPTION = /\b(?:decodeJwt|jwtDecode|jsonwebtoken)\b|\b(?:token|claims|payload)\s*(?:\?\.|\.)\s*exp\b|\bjwt[^\n;]{0,80}\b(?:expiry|expiration|remint)\b/i;
const BEARER_ONLY_ASSUMPTION = /(?:application|strategy|scheme|credentialKind|credentialType)\s*(?::|===|==)\s*['"`]bearer['"`]/i;
const CUSTOMER_BRANCH = /(?:if|switch)\s*\([^)]*(?:customerId|hostApp)\s*(?:===|!==|==|!=)\s*['"`][^'"`]+['"`][^)]*\)/i;

describe('Shinmone reference integration boundary', () => {
  it('keeps reference-specific credential, route, result, and identity assumptions out of generic orchestration', () => {
    const genericFiles = GENERIC_ROOTS.flatMap(sourceFiles);
    for (const file of genericFiles) {
      const source = readFileSync(resolve(file), 'utf8');
      expect({ file, match: source.match(REFERENCE_ASSUMPTION)?.[0] }).toEqual({ file, match: undefined });
      if (!file.includes('/service-auth/')) {
        expect({ file, match: source.match(GENERIC_CREDENTIAL_ASSUMPTION)?.[0] }).toEqual({ file, match: undefined });
      }
      expect({ file, match: source.match(BEARER_ONLY_ASSUMPTION)?.[0] }).toEqual({ file, match: undefined });
      expect({ file, match: source.match(CUSTOMER_BRANCH)?.[0] }).toEqual({ file, match: undefined });
    }
  });

  it('keeps reference material in the explicit integration, seed/configuration, and fixture surfaces', () => {
    expect(readFileSync(resolve('apps/customer-connector-runtime/integrations/shinmone/shinmone-idx-credential.provider.ts'), 'utf8'))
      .toMatch(/nativeAccessToken|acceptedEntry|decodeJwt/);
    expect(readFileSync(resolve('apps/customer-connector-runtime/integrations/shinmone/work-orders.monthly-new-count.manifest.json'), 'utf8'))
      .toMatch(/Dashboard\/KPIStats|newOrders/);
    expect(readFileSync(resolve('scripts/seed.ts'), 'utf8'))
      .toMatch(/work-orders\.monthly-new-count/);
  });
});

function sourceFiles(path: string): string[] {
  return readdirSync(resolve(path), { withFileTypes: true }).flatMap((entry) => {
    const child = `${path}/${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(child);
    return entry.isFile() && entry.name.endsWith('.ts') ? [child] : [];
  });
}
