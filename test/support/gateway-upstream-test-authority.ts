import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer, request as httpsRequest } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TLSSocket } from 'node:tls';
import { promisify } from 'node:util';
import { exportJWK, generateKeyPair, SignJWT, type KeyLike } from 'jose';
import { HardenedJwksTransport } from '../../apps/gateway/src/upstream-auth/jwks-transport.adapter';

const execFile = promisify(execFileCallback);
const AUTHORITY_HOSTNAME = 'gateway-upstream.test';
const DESTINATION_SAFE_TEST_ADDRESS = '93.184.216.34';

export type GatewayUpstreamTestAuthority = Readonly<{
  issuer: string;
  audience: string;
  kid: string;
  jwksUri: string;
  transport: HardenedJwksTransport;
  transportEvidence: Readonly<{
    resolvedHostnames: readonly string[];
    requestedUris: readonly string[];
    tlsAuthorizedConnections: readonly boolean[];
  }>;
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
 * Phase 8's sole external-identity authority. Its private signing key and
 * generated TLS key remain in process-local/test-temporary state. The real
 * HardenedJwksTransport validates the HTTPS hostname and destination decision;
 * its explicit request seam then reaches this loopback-only TLS fixture.
 */
export async function createGatewayUpstreamTestAuthority(input: Readonly<{
  signing?: Readonly<{ privateKey: KeyLike; publicKey: KeyLike; kid: string }>;
}> = {}): Promise<GatewayUpstreamTestAuthority> {
  const generated = input.signing === undefined ? await generateKeyPair('RS256') : undefined;
  const privateKey = input.signing?.privateKey ?? generated!.privateKey;
  const publicKey = input.signing?.publicKey ?? generated!.publicKey;
  const kid = input.signing?.kid ?? 'feature003-phase8-upstream';
  const publicJwk = await exportJWK(publicKey);
  const tls = await createTlsMaterial();
  const server = createServer({ key: tls.key, cert: tls.certificate }, (request, response) => {
    if (request.method !== 'GET' || request.url !== '/.well-known/jwks.json') {
      response.statusCode = 404;
      response.end();
      return;
    }
    response.setHeader('content-type', 'application/jwk-set+json');
    response.end(JSON.stringify({ keys: [{ ...publicJwk, kid, alg: 'RS256', use: 'sig' }] }));
  });

  try {
    await listen(server);
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Phase 8 upstream test authority did not expose a TCP listener.');

    const issuer = `https://${AUTHORITY_HOSTNAME}:${address.port}`;
    const audience = 'feature003-phase8-upstream';
    const jwksUri = `${issuer}/.well-known/jwks.json`;
    const resolvedHostnames: string[] = [];
    const requestedUris: string[] = [];
    const tlsAuthorizedConnections: boolean[] = [];
    const transport = new HardenedJwksTransport({
      resolve: async (hostname) => {
        resolvedHostnames.push(hostname);
        if (hostname !== AUTHORITY_HOSTNAME) throw new Error('Unexpected test authority hostname.');
        return [DESTINATION_SAFE_TEST_ADDRESS];
      },
      request: (url, lookup, signal) => requestLocalTlsAuthority({
        url,
        lookup,
        signal,
        localPort: address.port,
        trustedCertificate: tls.certificate,
        expectedUri: jwksUri,
        requestedUris,
        tlsAuthorizedConnections
      })
    });

    return Object.freeze({
      issuer,
      audience,
      kid,
      jwksUri,
      transport,
      transportEvidence: Object.freeze({ resolvedHostnames, requestedUris, tlsAuthorizedConnections }),
      issue: (input, options) => issue(privateKey, kid, issuer, audience, input, options),
      dispose: async () => {
        await close(server);
        await tls.dispose();
      }
    });
  } catch (error) {
    await close(server);
    await tls.dispose();
    throw error;
  }
}

async function createTlsMaterial(): Promise<Readonly<{
  key: string;
  certificate: string;
  dispose(): Promise<void>;
}>> {
  const directory = await mkdtemp(join(tmpdir(), 'gateway-upstream-tls-'));
  const keyPath = join(directory, 'server-key.pem');
  const certificatePath = join(directory, 'server-certificate.pem');
  try {
    await execFile('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '1',
      '-keyout', keyPath, '-out', certificatePath,
      '-subj', `/CN=${AUTHORITY_HOSTNAME}`,
      '-addext', `subjectAltName=DNS:${AUTHORITY_HOSTNAME}`,
      '-addext', 'basicConstraints=critical,CA:FALSE',
      '-addext', 'keyUsage=critical,digitalSignature,keyEncipherment',
      '-addext', 'extendedKeyUsage=serverAuth'
    ], { maxBuffer: 1024 * 1024 });
    const [key, certificate] = await Promise.all([
      readFile(keyPath, 'utf8'),
      readFile(certificatePath, 'utf8')
    ]);
    return Object.freeze({ key, certificate, dispose: () => rm(directory, { recursive: true, force: true }) });
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

async function requestLocalTlsAuthority(input: Readonly<{
  url: URL;
  lookup(hostname: string): Promise<string[]>;
  signal: AbortSignal;
  localPort: number;
  trustedCertificate: string;
  expectedUri: string;
  requestedUris: string[];
  tlsAuthorizedConnections: boolean[];
}>) {
  if (input.url.toString() !== input.expectedUri) throw new Error('Unexpected test JWKS URI.');
  const pinnedAddresses = await input.lookup(input.url.hostname);
  if (pinnedAddresses.length !== 1 || pinnedAddresses[0] !== DESTINATION_SAFE_TEST_ADDRESS) {
    throw new Error('Unexpected test JWKS destination decision.');
  }
  input.requestedUris.push(input.url.toString());

  return new Promise<Readonly<{
    statusCode: number;
    headers: Record<string, string | string[] | undefined>;
    body: AsyncIterable<Uint8Array>;
  }>>((resolve, reject) => {
    if (input.signal.aborted) return reject(new Error('Test JWKS request was aborted.'));
    const request = httpsRequest({
      protocol: 'https:',
      hostname: '127.0.0.1',
      port: input.localPort,
      path: `${input.url.pathname}${input.url.search}`,
      method: 'GET',
      servername: input.url.hostname,
      ca: input.trustedCertificate,
      rejectUnauthorized: true,
      headers: { accept: 'application/json, application/jwk-set+json', host: input.url.host }
    }, (response) => {
      const authorized = (response.socket as TLSSocket).authorized;
      input.tlsAuthorizedConnections.push(authorized);
      if (!authorized) {
        response.resume();
        reject(new Error('Test JWKS TLS authorization failed.'));
        return;
      }
      resolve({ statusCode: response.statusCode ?? 0, headers: response.headers, body: response });
    });
    const abort = () => request.destroy(new Error('Test JWKS request was aborted.'));
    input.signal.addEventListener('abort', abort, { once: true });
    request.once('close', () => input.signal.removeEventListener('abort', abort));
    request.once('error', reject);
    request.end();
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

function listen(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve, reject) => server.listen(0, '127.0.0.1', (error?: Error) => error ? reject(error) : resolve()));
}

function close(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve, reject) => !server.listening ? resolve() : server.close((error) => error ? reject(error) : resolve()));
}
