import { resolve } from 'node:path';

const targetPath = resolve(__dirname, '../../src/commands/local-signing-bootstrap.ts');

describe('local signing bootstrap boundary', () => {
  it.each([
    ['production', 'true'],
    ['development', 'false'],
    ['test', undefined]
  ])('fails closed outside the explicit local boundary (%s / %s)', async (nodeEnv, enabled) => {
    const { bootstrapLocalSigningKey } = loadTarget();
    const environment: Record<string, unknown> = {
      NODE_ENV: nodeEnv,
      DATABASE_URL: 'postgresql://gateway:gateway@127.0.0.1:5435/local_bootstrap_test',
      GATEWAY_INTERNAL_JWT_ISSUER: 'http://gateway.test',
      GATEWAY_INTERNAL_JWT_AUDIENCE: 'internal-audience',
      GATEWAY_PUBLIC_JWKS_URL: 'http://gateway.test/.well-known/jwks.json',
      GATEWAY_UPSTREAM_JWT_ISSUER: 'http://upstream.test',
      GATEWAY_UPSTREAM_JWT_AUDIENCE: 'upstream-audience',
      GATEWAY_UPSTREAM_JWKS_URI: 'http://upstream.test/.well-known/jwks.json',
      GATEWAY_UPSTREAM_JWT_CLOCK_TOLERANCE_SECONDS: '0',
      GATEWAY_INTERNAL_JWT_TTL_SECONDS: '300',
      GATEWAY_BACKEND_BASE_URL: 'http://backend.test',
      GATEWAY_SIGNING_KEY_REFERENCE: 'file:/not-read-before-boundary.pem',
      GATEWAY_ALLOWED_ORIGINS: 'http://localhost:3001',
      ...(enabled === undefined ? {} : { GATEWAY_LOCAL_SIGNING_BOOTSTRAP_ENABLED: enabled })
    };

    await expect(bootstrapLocalSigningKey(environment)).rejects.toMatchObject(genericUnavailable());
  });
});

function loadTarget(): { bootstrapLocalSigningKey: (environment: Record<string, unknown>) => Promise<unknown> } {
  const target = require(targetPath) as { bootstrapLocalSigningKey?: (environment: Record<string, unknown>) => Promise<unknown> };
  if (!target.bootstrapLocalSigningKey) throw new Error('Required local signing bootstrap production surface missing.');
  return { bootstrapLocalSigningKey: target.bootstrapLocalSigningKey };
}

function genericUnavailable() { return { status: 503, code: 'IDENTITY_SERVICE_UNAVAILABLE', message: 'Identity service is unavailable.' }; }
