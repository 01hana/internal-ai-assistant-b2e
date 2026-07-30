import { decodeProtectedHeader, exportJWK, generateKeyPair, importJWK, JWK, jwtVerify, KeyLike, SignJWT } from 'jose';
import { IdentityContextException, IdentityTokenException } from '../../src/identity/identity.errors';
import { toInternalIdentityClaims } from '../../src/identity/internal-identity-token-verifier';

describe('internal identity JWT claims', () => {
  let privateKey: KeyLike;
  let publicJwk: JWK;

  beforeAll(async () => {
    const keyPair = await generateKeyPair('RS256');
    privateKey = keyPair.privateKey;
    publicJwk = { ...(await exportJWK(keyPair.publicKey)), kid: 'gateway-test-key', use: 'sig', alg: 'RS256' };
  });

  it('accepts a Gateway RS256 token and maps canonical claims', async () => {
    const payload = await verify(await signToken());
    expect(toInternalIdentityClaims(payload)).toEqual({
      subject: 'actor-001',
      organizationId: 'org-001',
      role: 'planner',
      permissionScopes: ['orders:read', 'inventory:read'],
      hostApp: 'admin',
      tokenId: 'token-001'
    });
  });

  it('rejects invalid issuer, audience, expiry, kid, and signature before claims mapping', async () => {
    await expect(verify(await signToken({ issuer: 'https://other-gateway' }))).rejects.toBeDefined();
    await expect(verify(await signToken({ audience: 'other-service' }))).rejects.toBeDefined();
    await expect(verify(await signToken({ expirationTime: '1 second ago' }))).rejects.toBeDefined();
    await expect(verify(await signToken({ kid: 'unknown-key' }))).rejects.toBeDefined();
    await expect(verify('not.a.jwt')).rejects.toBeDefined();
  });

  it('rejects cryptographically valid tokens with incomplete identity claims', async () => {
    await expect(verify(await signToken({ claims: { permission_scopes: [] } }))).resolves.toBeDefined();
    const payload = await verify(await signToken({ claims: { permission_scopes: [] } }));
    expect(() => toInternalIdentityClaims(payload)).toThrow(IdentityContextException);
  });

  async function verify(token: string) {
    try {
      if (decodeProtectedHeader(token).kid !== 'gateway-test-key') {
        throw new Error('Unknown kid.');
      }
      const key = await importJWK(publicJwk, 'RS256');
      return (await jwtVerify(token, key, {
        issuer: 'https://gateway.internal',
        audience: 'internal-ai-assistant',
        algorithms: ['RS256']
      })).payload;
    } catch {
      throw new IdentityTokenException();
    }
  }

  async function signToken(input: {
    issuer?: string;
    audience?: string;
    expirationTime?: string;
    kid?: string;
    claims?: Record<string, unknown>;
  } = {}) {
    return new SignJWT({
      org_id: 'org-001',
      role: 'planner',
      permission_scopes: ['orders:read', 'inventory:read'],
      host_app: 'admin',
      ...input.claims
    })
      .setProtectedHeader({ alg: 'RS256', kid: input.kid ?? 'gateway-test-key' })
      .setIssuer(input.issuer ?? 'https://gateway.internal')
      .setAudience(input.audience ?? 'internal-ai-assistant')
      .setSubject('actor-001')
      .setJti('token-001')
      .setIssuedAt()
      .setExpirationTime(input.expirationTime ?? '5 minutes')
      .sign(privateKey);
  }
});
