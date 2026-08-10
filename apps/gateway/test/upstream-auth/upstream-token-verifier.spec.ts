import { createUpstreamJwksFixture, type UpstreamJwksFixture } from './upstream-jwks.fixture';

describe('Upstream RS256 Remote-JWKS verifier (T028)', () => {
  let fixture: UpstreamJwksFixture;
  beforeAll(async () => { fixture = await createUpstreamJwksFixture(); });
  afterAll(async () => { await fixture.close(); });

  it('accepts a valid RS256 upstream token', async () => {
    const verifier = await verifierFor(fixture);
    await expect(verifier.verify({ authorization: `Bearer ${await fixture.issue()}` })).resolves.toMatchObject({ integrationId: 'integration-a' });
  });

  it('preserves the configured issuer through environment validation and rejects a trailing-slash mismatch', async () => {
    const { validateGatewayEnvironment, GatewayConfigService } = require('../../src/config/gateway-config.service') as {
      validateGatewayEnvironment?: (input: Record<string, unknown>) => Record<string, unknown>;
      GatewayConfigService?: new (environment: Record<string, unknown>) => { upstreamVerification: unknown };
    };
    const { RemoteJwksUpstreamTokenVerifier } = require('../../src/upstream-auth/upstream-token-verifier.service') as {
      RemoteJwksUpstreamTokenVerifier?: new (config: unknown) => { verify(input: unknown): Promise<unknown> };
    };
    expect(validateGatewayEnvironment).toEqual(expect.any(Function));
    expect(GatewayConfigService).toEqual(expect.any(Function));
    expect(RemoteJwksUpstreamTokenVerifier).toEqual(expect.any(Function));

    const environment = validateGatewayEnvironment?.(gatewayEnvironmentFor(fixture));
    const config = new (GatewayConfigService as new (environment: Record<string, unknown>) => { upstreamVerification: unknown })(environment ?? {}).upstreamVerification;
    const verifier = new (RemoteJwksUpstreamTokenVerifier as new (config: unknown) => { verify(input: unknown): Promise<unknown> })(config);

    await expect(verifier.verify({ authorization: `Bearer ${await fixture.issue()}` })).resolves.toMatchObject({ integrationId: 'integration-a' });
    const mismatchedEnvironment = validateGatewayEnvironment?.({ ...gatewayEnvironmentFor(fixture), GATEWAY_UPSTREAM_JWT_ISSUER: `${fixture.issuer}/` });
    const mismatchedConfig = new (GatewayConfigService as new (environment: Record<string, unknown>) => { upstreamVerification: unknown })(mismatchedEnvironment ?? {}).upstreamVerification;
    const mismatchedVerifier = new (RemoteJwksUpstreamTokenVerifier as new (config: unknown) => { verify(input: unknown): Promise<unknown> })(mismatchedConfig);
    await expect(mismatchedVerifier.verify({ authorization: `Bearer ${await fixture.issue()}` })).rejects.toMatchObject({ status: 401, code: 'UPSTREAM_IDENTITY_INVALID', reasonCode: 'issuer_mismatch' });
  });

  it.each([
    ['wrong issuer', { iss: 'https://wrong.example' }, 'issuer_mismatch'],
    ['wrong audience', { aud: 'wrong-audience' }, 'audience_mismatch'],
    ['expired exp', { exp: 1 }, 'token_expired'],
    ['future iat', { iat: 9_999_999_999 }, 'invalid_iat'],
    ['future nbf', { nbf: 9_999_999_999 }, 'token_not_yet_valid'],
    ['missing iat', { iat: undefined }, 'invalid_iat'],
    ['invalid exp', { exp: 'not-a-date' }, 'token_expired'],
    ['invalid nbf', { nbf: 'not-a-date' }, 'token_not_yet_valid']
  ])('rejects %s with a generic denial and internal diagnostic', async (_label, claims, reasonCode) => {
    const verifier = await verifierFor(fixture);
    await expect(verifier.verify({ authorization: `Bearer ${await fixture.issue(claims)}` })).rejects.toMatchObject({ status: 401, code: 'UPSTREAM_IDENTITY_INVALID', reasonCode });
  });

  it('accepts a valid optional nbf and rejects malformed/signature/kid/algorithm variants', async () => {
    const verifier = await verifierFor(fixture);
    await expect(verifier.verify({ authorization: `Bearer ${await fixture.issue({ nbf: Math.floor(Date.now() / 1000) - 1 })}` })).resolves.toBeDefined();
    const valid = await fixture.issue();
    const [header, payload, signature] = valid.split('.');
    const badSignature = `${header}.${payload}.${signature.startsWith('a') ? 'b' : 'a'}${signature.slice(1)}`;
    await expect(verifier.verify({ authorization: `Bearer ${badSignature}` })).rejects.toMatchObject({ status: 401, code: 'UPSTREAM_IDENTITY_INVALID', reasonCode: 'invalid_signature' });
    for (const token of ['not.a.jwt', await fixture.issue({}, { kid: '' }), ...['HS256', 'RS384', 'RS512', 'PS256', 'ES256', 'none'].map((alg) => unsignedToken(alg))]) {
      await expect(verifier.verify({ authorization: `Bearer ${token}` })).rejects.toMatchObject({ status: 401, code: 'UPSTREAM_IDENTITY_INVALID' });
    }
  });
});

async function verifierFor(fixture: UpstreamJwksFixture) {
  const target = require('../../src/upstream-auth/upstream-token-verifier.service') as { RemoteJwksUpstreamTokenVerifier?: new (config: unknown) => { verify(input: unknown): Promise<unknown> } };
  if (!target.RemoteJwksUpstreamTokenVerifier) throw new Error('Expected Phase 3 upstream verifier implementation.');
  return new target.RemoteJwksUpstreamTokenVerifier({ issuer: fixture.issuer, audience: fixture.audience, jwksUri: fixture.jwksUri, clockToleranceSeconds: 0 });
}

function gatewayEnvironmentFor(fixture: UpstreamJwksFixture): Record<string, unknown> {
  return {
    GATEWAY_INTERNAL_JWT_ISSUER: 'http://gateway.test',
    GATEWAY_INTERNAL_JWT_AUDIENCE: 'internal-audience',
    GATEWAY_PUBLIC_JWKS_URL: 'http://gateway.test/.well-known/jwks.json',
    GATEWAY_UPSTREAM_JWT_ISSUER: fixture.issuer,
    GATEWAY_UPSTREAM_JWT_AUDIENCE: fixture.audience,
    GATEWAY_UPSTREAM_JWKS_URI: fixture.jwksUri,
    GATEWAY_UPSTREAM_JWT_CLOCK_TOLERANCE_SECONDS: '0',
    GATEWAY_INTERNAL_JWT_TTL_SECONDS: '300',
    GATEWAY_BACKEND_BASE_URL: 'http://backend.test',
    GATEWAY_SIGNING_KEY_REFERENCE: 'key-reference',
    GATEWAY_PORT: '4000'
  };
}

function unsignedToken(alg: string): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg, kid: 'attacker-key' })}.${encode({ iat: 1, exp: 9_999_999_999 })}.x`;
}
