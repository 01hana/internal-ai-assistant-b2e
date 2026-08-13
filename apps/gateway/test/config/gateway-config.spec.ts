import { join } from 'node:path';

const configTarget = join(process.cwd(), 'src', 'config', 'gateway-config.service');

describe('Gateway configuration contract', () => {
  it('fails closed for missing or malformed future trust-chain settings', () => {
    const target = require(configTarget) as {
      validateGatewayEnvironment?: (input: Record<string, unknown>) => unknown;
    };
    expect(target.validateGatewayEnvironment).toEqual(expect.any(Function));

    expect(() => target.validateGatewayEnvironment?.({})).toThrow('Invalid Gateway configuration.');
    expect(() =>
      target.validateGatewayEnvironment?.({
        GATEWAY_INTERNAL_JWT_ISSUER: 'http://gateway.test',
        GATEWAY_INTERNAL_JWT_AUDIENCE: 'internal-audience',
        GATEWAY_PUBLIC_JWKS_URL: 'not-a-url',
        GATEWAY_UPSTREAM_JWT_ISSUER: 'http://upstream.test',
        GATEWAY_UPSTREAM_JWT_AUDIENCE: 'upstream-audience',
        GATEWAY_UPSTREAM_JWKS_URI: 'http://upstream.test/jwks',
        GATEWAY_UPSTREAM_JWT_CLOCK_TOLERANCE_SECONDS: '301',
        GATEWAY_INTERNAL_JWT_TTL_SECONDS: '300',
        GATEWAY_BACKEND_BASE_URL: 'http://backend.test',
        GATEWAY_SIGNING_KEY_REFERENCE: 'key-reference',
        GATEWAY_PORT: '4000'
      })
    ).toThrow('Invalid Gateway configuration.');
  });

  it('returns typed, safe configuration without performing identity work', () => {
    const target = require(configTarget) as {
      validateGatewayEnvironment?: (input: Record<string, unknown>) => Record<string, unknown>;
      GatewayConfigService?: new (environment: Record<string, unknown>) => { upstreamVerification: Record<string, unknown> };
    };
    const config = target.validateGatewayEnvironment?.(validEnvironment());

    expect(config).toMatchObject({
      internalIssuer: 'http://gateway.test',
      internalAudience: 'internal-audience',
      internalTokenTtlSeconds: 300,
      allowedOrigins: ['http://localhost:3001'],
      localSigningBootstrapEnabled: false,
      port: 4000
    });
    expect(config).not.toHaveProperty('privateKey');
    expect(new (target.GatewayConfigService as new (environment: Record<string, unknown>) => { upstreamVerification: Record<string, unknown> })(config ?? {}).upstreamVerification).toEqual({
      issuer: 'http://upstream.test', audience: 'upstream-audience', jwksUri: 'http://upstream.test/.well-known/jwks.json', clockToleranceSeconds: 0
    });
  });

  it('preserves trimmed issuer strings exactly while normalizing network endpoints', () => {
    const target = require(configTarget) as {
      validateGatewayEnvironment?: (input: Record<string, unknown>) => Record<string, unknown>;
    };

    const config = target.validateGatewayEnvironment?.({
      ...validEnvironment(),
      GATEWAY_INTERNAL_JWT_ISSUER: ' https://gateway.example ',
      GATEWAY_UPSTREAM_JWT_ISSUER: ' https://issuer.example/ ',
      GATEWAY_UPSTREAM_JWKS_URI: 'https://upstream.example'
    });

    expect(config).toMatchObject({
      internalIssuer: 'https://gateway.example',
      upstreamIssuer: 'https://issuer.example/',
      upstreamJwksUri: 'https://upstream.example/'
    });
  });

  it.each(['key-reference', 'file:/tmp/gateway-private.pem', './.keys/gateway-private.pem', 'provider://gateway/signing-key'])(
    'accepts %s as an opaque signing-key reference',
    (signingKeyReference) => {
      const target = require(configTarget) as {
        validateGatewayEnvironment?: (input: Record<string, unknown>) => Record<string, unknown>;
      };

      expect(target.validateGatewayEnvironment?.({ ...validEnvironment(), GATEWAY_SIGNING_KEY_REFERENCE: signingKeyReference })).toMatchObject({
        signingKeyReference
      });
    }
  );

  it.each([
    '',
    '   ',
    '-----BEGIN PRIVATE KEY-----\nprivate-material\n-----END PRIVATE KEY-----',
    '-----BEGIN RSA PRIVATE KEY-----\nprivate-material\n-----END RSA PRIVATE KEY-----',
    '-----BEGIN EC PRIVATE KEY-----\nprivate-material\n-----END EC PRIVATE KEY-----',
    'Bearer credential-material',
    'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJhY3RvciJ9.signature',
    'key\u0000reference'
  ])('rejects raw signing material without reflecting %j', (signingKeyReference) => {
    const target = require(configTarget) as {
      validateGatewayEnvironment?: (input: Record<string, unknown>) => Record<string, unknown>;
    };

    try {
      target.validateGatewayEnvironment?.({ ...validEnvironment(), GATEWAY_SIGNING_KEY_REFERENCE: signingKeyReference });
      throw new Error('Expected signing-key reference validation to fail.');
    } catch (error) {
      expect(error).toHaveProperty('message', 'Invalid Gateway configuration.');
      if (signingKeyReference !== '') {
        expect((error as Error).message).not.toContain(signingKeyReference);
      }
    }
  });

  it('accepts only explicit, normalized browser origins and a disabled local bootstrap flag by default', () => {
    const target = require(configTarget) as { validateGatewayEnvironment?: (input: Record<string, unknown>) => Record<string, unknown> };
    expect(target.validateGatewayEnvironment?.({
      ...validEnvironment(),
      GATEWAY_ALLOWED_ORIGINS: ' http://localhost:3001 ,https://host.example,http://localhost:3001 ',
      GATEWAY_LOCAL_SIGNING_BOOTSTRAP_ENABLED: 'true'
    })).toMatchObject({
      allowedOrigins: ['http://localhost:3001', 'https://host.example'],
      localSigningBootstrapEnabled: true
    });
  });

  it.each(['', '   ', '*', 'http://localhost:3001,*', 'not-an-origin', 'ftp://host.example', 'http://user:password@host.example'])(
    'fails closed for invalid CORS origins %j',
    (origins) => {
      const target = require(configTarget) as { validateGatewayEnvironment?: (input: Record<string, unknown>) => unknown };
      expect(() => target.validateGatewayEnvironment?.({ ...validEnvironment(), GATEWAY_ALLOWED_ORIGINS: origins })).toThrow('Invalid Gateway configuration.');
    }
  );
});

function validEnvironment(): Record<string, unknown> {
  return {
    GATEWAY_INTERNAL_JWT_ISSUER: 'http://gateway.test',
    GATEWAY_INTERNAL_JWT_AUDIENCE: 'internal-audience',
    GATEWAY_PUBLIC_JWKS_URL: 'http://gateway.test/.well-known/jwks.json',
    GATEWAY_UPSTREAM_JWT_ISSUER: 'http://upstream.test',
    GATEWAY_UPSTREAM_JWT_AUDIENCE: 'upstream-audience',
    GATEWAY_UPSTREAM_JWKS_URI: 'http://upstream.test/.well-known/jwks.json',
    GATEWAY_UPSTREAM_JWT_CLOCK_TOLERANCE_SECONDS: '0',
    GATEWAY_INTERNAL_JWT_TTL_SECONDS: '300',
    GATEWAY_BACKEND_BASE_URL: 'http://backend.test',
    GATEWAY_SIGNING_KEY_REFERENCE: 'key-reference',
    GATEWAY_ALLOWED_ORIGINS: 'http://localhost:3001',
    GATEWAY_PORT: '4000'
  };
}
