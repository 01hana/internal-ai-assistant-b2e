import { createServer, type Server } from 'node:http';
import { exportJWK, generateKeyPair, SignJWT, type KeyLike } from 'jose';

export type GatewayUpstreamTestAuthority = Readonly<{
  issuer: string;
  audience: string;
  kid: string;
  jwksUri: string;
  issue(input: Readonly<{
    integrationId: string;
    subject: string;
    organizationId: string;
    hostApp: string;
    roles: readonly string[];
    permissionScopes: readonly string[];
  }>, options?: Readonly<{
    issuer?: string;
    audience?: string;
    issuedAt?: number;
    expiresAt?: number;
    notBefore?: number;
    kid?: string;
  }>): Promise<string>;
  dispose(): Promise<void>;
}>;

/**
 * Phase 8's sole external-identity authority. Its private key remains in
 * process memory; the HTTP listener publishes only its public JWK.
 */
export async function createGatewayUpstreamTestAuthority(): Promise<GatewayUpstreamTestAuthority> {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const kid = 'feature003-phase8-upstream';
  const publicJwk = await exportJWK(publicKey);
  const server = createServer((request, response) => {
    if (request.method !== 'GET' || request.url !== '/.well-known/jwks.json') {
      response.statusCode = 404;
      response.end();
      return;
    }
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ keys: [{ ...publicJwk, kid, alg: 'RS256', use: 'sig' }] }));
  });
  await listen(server);
  const address = server.address();
  if (!address || typeof address === 'string') {
    await close(server);
    throw new Error('Phase 8 upstream test authority did not expose a TCP listener.');
  }

  const issuer = `http://127.0.0.1:${address.port}`;
  const audience = 'feature003-phase8-upstream';
  return Object.freeze({
    issuer,
    audience,
    kid,
    jwksUri: `${issuer}/.well-known/jwks.json`,
    issue: (input, options) => issue(privateKey, kid, issuer, audience, input, options),
    dispose: () => close(server)
  });
}

async function issue(
  privateKey: KeyLike,
  kid: string,
  issuer: string,
  audience: string,
  input: Readonly<{
    integrationId: string;
    subject: string;
    organizationId: string;
    hostApp: string;
    roles: readonly string[];
    permissionScopes: readonly string[];
  }>,
  options: Readonly<{
    issuer?: string;
    audience?: string;
    issuedAt?: number;
    expiresAt?: number;
    notBefore?: number;
    kid?: string;
  }> = {}
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const token = new SignJWT({
    integration_id: input.integrationId,
    sub: input.subject,
    org_id: input.organizationId,
    host_app: input.hostApp,
    roles: [...input.roles],
    permission_scopes: [...input.permissionScopes]
  })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid: options.kid ?? kid })
    .setIssuer(options.issuer ?? issuer)
    .setAudience(options.audience ?? audience)
    .setIssuedAt(options.issuedAt ?? now)
    .setExpirationTime(options.expiresAt ?? now + 120);
  if (options.notBefore !== undefined) token.setNotBefore(options.notBefore);
  return token.sign(privateKey);
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.listen(0, '127.0.0.1', (error?: Error) => error ? reject(error) : resolve()));
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
