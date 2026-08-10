import { createServer, type Server } from 'node:http';
import { exportJWK, generateKeyPair, SignJWT, type JWK, type KeyLike } from 'jose';

export type UpstreamJwksFixture = Readonly<{
  issuer: string;
  audience: string;
  jwksUri: string;
  issue(claims?: Record<string, unknown>, header?: Record<string, unknown>): Promise<string>;
  close(): Promise<void>;
}>;

export async function createUpstreamJwksFixture(): Promise<UpstreamJwksFixture> {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey);
  const kid = 'phase3-upstream-test-key';
  const server = createServer((request, response) => {
    if (request.url !== '/jwks') {
      response.statusCode = 404;
      response.end();
      return;
    }
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ keys: [{ ...jwk, kid, alg: 'RS256', use: 'sig' }] }));
  });
  await listen(server);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Upstream JWKS fixture did not expose a TCP address.');
  const issuer = `http://127.0.0.1:${address.port}`;
  const audience = 'gateway-upstream-test';

  return Object.freeze({
    issuer,
    audience,
    jwksUri: `${issuer}/jwks`,
    issue: (claims = {}, header = {}) => sign(privateKey, kid, issuer, audience, claims, header),
    close: () => close(server)
  });
}

async function sign(privateKey: KeyLike, kid: string, issuer: string, audience: string, claims: Record<string, unknown>, header: Record<string, unknown>) {
  const now = Math.floor(Date.now() / 1000);
  const { iss: claimIssuer, aud: claimAudience, ...identityClaims } = claims;
  const payload = {
    integration_id: 'integration-a', sub: 'actor-a', org_id: 'org-shared', host_app: 'admin', roles: ['planner'], permission_scopes: ['orders:read'],
    iat: now, exp: now + 120, ...identityClaims
  };
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'RS256', kid, ...header })
    .setIssuer(typeof claimIssuer === 'string' ? claimIssuer : issuer)
    .setAudience(typeof claimAudience === 'string' ? claimAudience : audience)
    .sign(privateKey);
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.listen(0, '127.0.0.1', (error?: Error) => error ? reject(error) : resolve()));
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
