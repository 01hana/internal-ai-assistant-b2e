import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodeJwt, decodeProtectedHeader, jwtVerify } from 'jose';
import { createEphemeralRsaFixture } from '../signing/ephemeral-rsa.fixture';

const issuerPath = resolve(__dirname, '../../src/identity/internal-identity-token-issuer.service.ts');

describe('Internal identity token issuer contract (T043)', () => {
  it('requires the Phase 5 issuer production surface', () => {
    expect(existsSync(issuerPath)).toBe(true);
  });

  it('issues only Gateway-selected metadata and canonical identity claims', async () => {
    const fixture = await createEphemeralRsaFixture();
    const issuer = createIssuer(fixture);
    const beforeIssue = Math.floor(Date.now() / 1000);
    const token = await issuer.issue({
      customerId: 'customer-a',
      integrationId: 'integration-a',
      subject: 'actor-shared',
      organizationId: 'org-shared',
      hostApp: 'admin',
      roles: ['planner'],
      permissionScopes: ['orders:read'],
      customer_id: 'customer-attacker',
      jti: 'attacker-jti',
      iss: 'https://attacker.example',
      aud: 'attacker-audience',
      iat: 1,
      exp: 1,
      nbf: 1,
      kid: 'attacker-kid',
      alg: 'none',
      attacker_extra_claim: 'attacker-value'
    } as never);
    const afterIssue = Math.floor(Date.now() / 1000);

    const header = decodeProtectedHeader(token);
    const payload = decodeJwt(token);
    await expect(jwtVerify(token, fixture.publicKey, { algorithms: ['RS256'], issuer: 'https://gateway.test', audience: 'internal-audience' })).resolves.toBeDefined();
    expect(header).toEqual({ alg: 'RS256', typ: 'JWT', kid: fixture.kid });
    expect(payload).toMatchObject({
      customer_id: 'customer-a',
      integration_id: 'integration-a',
      sub: 'actor-shared',
      org_id: 'org-shared',
      host_app: 'admin',
      roles: ['planner'],
      permission_scopes: ['orders:read'],
      iss: 'https://gateway.test',
      aud: 'internal-audience'
    });
    expect(Object.keys(payload).sort()).toEqual([
      'aud', 'customer_id', 'exp', 'host_app', 'iat', 'integration_id',
      'iss', 'jti', 'org_id', 'permission_scopes', 'roles', 'sub'
    ].sort());
    for (const callerOrInternalField of [
      'customerId', 'integrationId', 'subject', 'organizationId', 'hostApp',
      'permissionScopes', 'alg', 'kid', 'nbf', 'attacker_extra_claim'
    ]) {
      expect(payload).not.toHaveProperty(callerOrInternalField);
    }
    expect(payload).not.toHaveProperty('nbf');
    expect(payload.iat).toEqual(expect.any(Number));
    expect(payload.iat).not.toBe(1);
    expect(payload.iat).toBeGreaterThanOrEqual(beforeIssue);
    expect(payload.iat).toBeLessThanOrEqual(afterIssue);
    expect(payload.exp).toBe((payload.iat as number) + 300);
    expect(payload.jti).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it('creates a fresh Gateway jti and preserves valid empty role and scope arrays', async () => {
    const fixture = await createEphemeralRsaFixture();
    const issuer = createIssuer(fixture);
    const identity = {
      customerId: 'customer-a', integrationId: 'integration-a', subject: 'actor-shared', organizationId: 'org-shared', hostApp: 'admin', roles: [], permissionScopes: []
    };
    const [first, second] = await Promise.all([issuer.issue(identity), issuer.issue(identity)]);

    expect(decodeJwt(first)).toMatchObject({ roles: [], permission_scopes: [] });
    expect(decodeJwt(second)).toMatchObject({ roles: [], permission_scopes: [] });
    expect(decodeJwt(first).jti).not.toBe(decodeJwt(second).jti);
  });
});

function createIssuer(fixture: Awaited<ReturnType<typeof createEphemeralRsaFixture>>) {
  if (!existsSync(issuerPath)) throw new Error('Expected Phase 5 InternalIdentityTokenIssuer production surface.');
  const target = require(issuerPath) as {
    InternalIdentityTokenIssuer?: new (
      config: Readonly<{ internalIssuer: string; internalAudience: string; internalTokenTtlSeconds: number }>,
      activeKeyResolver: Readonly<{ resolveActiveSigningKey(): Promise<Readonly<{ kid: string; privateKey: unknown }>> }>
    ) => { issue(identity: unknown): Promise<string> };
  };
  if (!target.InternalIdentityTokenIssuer) throw new Error('Expected Phase 5 InternalIdentityTokenIssuer production surface.');
  return new target.InternalIdentityTokenIssuer(
    Object.freeze({ internalIssuer: 'https://gateway.test', internalAudience: 'internal-audience', internalTokenTtlSeconds: 300 }),
    Object.freeze({ resolveActiveSigningKey: async () => Object.freeze({ kid: fixture.kid, privateKey: fixture.privateKey }) })
  );
}
