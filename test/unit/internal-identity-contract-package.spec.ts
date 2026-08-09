import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const packageRoot = join(process.cwd(), 'packages', 'internal-identity-contract');
const expectedClaims = ['customer_id', 'integration_id', 'sub', 'org_id', 'host_app', 'roles', 'permission_scopes', 'jti'];
const expectedRegisteredClaims = ['iss', 'aud', 'iat', 'exp', 'nbf'];

describe('internal identity contract package boundary', () => {
  it('publishes only the validation-neutral canonical JWT vocabulary', () => {
    expect(existsSync(packageRoot)).toBe(true);

    const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
      name?: string;
      private?: boolean;
      exports?: Record<string, unknown>;
    };
    expect(manifest).toMatchObject({
      name: '@internal-ai-assistant/internal-identity-contract',
      private: true
    });
    expect(manifest.exports?.['.']).toBeDefined();

    const contract = require(packageRoot) as Record<string, unknown>;
    expect(contract.CANONICAL_INTERNAL_IDENTITY_CLAIM_NAMES).toEqual(expectedClaims);
    expect(contract.REGISTERED_JWT_CLAIM_NAMES).toEqual(expectedRegisteredClaims);
    expect(contract.INTERNAL_IDENTITY_JWT_KEY_ID_HEADER).toBe('kid');
    expect(contract.INTERNAL_IDENTITY_JWT_ALGORITHM).toBe('RS256');
    expect(Object.keys(contract).sort()).toEqual([
      'CANONICAL_INTERNAL_IDENTITY_CLAIM_NAMES',
      'INTERNAL_IDENTITY_JWT_ALGORITHM',
      'INTERNAL_IDENTITY_JWT_KEY_ID_HEADER',
      'REGISTERED_JWT_CLAIM_NAMES'
    ]);
  });

  it('contains no runtime identity authority or infrastructure dependency', () => {
    expect(existsSync(packageRoot)).toBe(true);

    const source = readPackageSource(packageRoot);
    expect(source).not.toMatch(/@nestjs\/|@prisma\/|\bprisma\b|\bjose\b/i);
    expect(source).not.toMatch(/CustomerScope|IdentityGuard|TokenVerifier|SigningKeyProvider|InternalIdentityTokenIssuer/i);
    expect(source).not.toMatch(/repository|authorization|fetch\(|axios|http\.request|logger|audit/i);
  });
});

function readPackageSource(directory: string): string {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const entryPath = join(directory, entry.name);
      if (entry.isDirectory()) return readPackageSource(entryPath);
      return entry.name.endsWith('.ts') || entry.name.endsWith('.json') ? [readFileSync(entryPath, 'utf8')] : [];
    })
    .join('\n');
}
