import {
  MAX_INTERNAL_IDENTITY_CLOCK_TOLERANCE_SECONDS,
  validateEnvironment
} from '../../src/common/config/env.validation';
import {
  createStaticInternalIdentityTokenVerifier,
  internalIdentityTokenVerifierForTest,
  RemoteJwksInternalIdentityTokenVerifier
} from '../../src/identity/internal-identity-token-verifier';
import { InternalIdentityConfigurationError, validateInternalIdentityConfig } from '../../src/identity/identity-token.types';
import { createInternalIdentityJwtFixture, TEST_BACKEND_AUDIENCE, TEST_GATEWAY_ISSUER } from '../support/internal-identity-jwt.helper';

const validEnv = {
  DATABASE_URL: 'postgresql://assistant:assistant_dev_password@localhost:5432/assistant_dev',
  POSTGRES_USER: 'assistant',
  POSTGRES_PASSWORD: 'assistant_dev_password',
  POSTGRES_DB: 'assistant_dev',
  LLM_PROVIDER: 'openai',
  LLM_MODEL: 'local-placeholder-model',
  OPENAI_API_KEY: 'placeholder-openai-api-key',
  INTERNAL_IDENTITY_JWT_ISSUER: TEST_GATEWAY_ISSUER,
  INTERNAL_IDENTITY_JWT_AUDIENCE: TEST_BACKEND_AUDIENCE,
  INTERNAL_IDENTITY_JWKS_URI: 'https://gateway.test.internal/.well-known/jwks.json',
  NODE_ENV: 'test'
};

describe('validateEnvironment', () => {
  it('accepts the required phase 1 environment variables', () => {
    expect(validateEnvironment(validEnv)).toMatchObject({
      DATABASE_URL: validEnv.DATABASE_URL,
      LLM_PROVIDER: 'openai',
      LLM_MODEL: validEnv.LLM_MODEL,
      OPENAI_API_KEY: validEnv.OPENAI_API_KEY,
      ENABLE_SWAGGER_DOCS: false,
      SWAGGER_PATH: 'docs'
    });
  });

  it('fails fast when required environment variables are missing', () => {
    expect(() => validateEnvironment({ ...validEnv, DATABASE_URL: undefined })).toThrow(
      /Invalid environment configuration/
    );
  });

  it('defaults the v1 LLM provider to openai when omitted', () => {
    const { LLM_PROVIDER: _llmProvider, ...envWithoutProvider } = validEnv;

    expect(validateEnvironment(envWithoutProvider)).toMatchObject({
      LLM_PROVIDER: 'openai'
    });
  });

  it('fails fast when an unsupported LLM provider is configured', () => {
    expect(() => validateEnvironment({ ...validEnv, LLM_PROVIDER: 'unsupported-provider' })).toThrow(
      /Invalid environment configuration/
    );
  });

  it('parses swagger docs settings from environment variables', () => {
    expect(
      validateEnvironment({
        ...validEnv,
        ENABLE_SWAGGER_DOCS: 'true',
        SWAGGER_PATH: 'internal/docs'
      })
    ).toMatchObject({
      ENABLE_SWAGGER_DOCS: true,
      SWAGGER_PATH: 'internal/docs'
    });
  });

  it.each([0, 1, MAX_INTERNAL_IDENTITY_CLOCK_TOLERANCE_SECONDS])(
    'accepts internal identity clock tolerance %s within the bounded range',
    (clockToleranceSeconds) => {
      expect(
        validateEnvironment({
          ...validEnv,
          INTERNAL_IDENTITY_JWT_CLOCK_TOLERANCE_SECONDS: String(clockToleranceSeconds)
        })
      ).toMatchObject({ INTERNAL_IDENTITY_JWT_CLOCK_TOLERANCE_SECONDS: clockToleranceSeconds });
    }
  );

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 'not-a-number', MAX_INTERNAL_IDENTITY_CLOCK_TOLERANCE_SECONDS + 1, 86400, 999999999])(
    'fails fast for invalid internal identity clock tolerance %p',
    (clockToleranceSeconds) => {
      expect(() =>
        validateEnvironment({
          ...validEnv,
          INTERNAL_IDENTITY_JWT_CLOCK_TOLERANCE_SECONDS: clockToleranceSeconds
        })
      ).toThrow(/Invalid environment configuration/);
    }
  );

  it('rejects invalid direct verifier configuration without exposing material', () => {
    const unsafeConfig = {
      issuer: 'issuer-without-secret',
      audience: 'audience-without-secret',
      jwksUri: 'https://gateway.example.internal/.well-known/jwks.json',
      clockToleranceSeconds: MAX_INTERNAL_IDENTITY_CLOCK_TOLERANCE_SECONDS + 1
    };

    const error = captureError(() => validateInternalIdentityConfig(unsafeConfig));
    expect(error).toBeInstanceOf(InternalIdentityConfigurationError);
    expect(error.message).toBe('Invalid internal identity configuration.');
    expect(error.message).not.toContain(unsafeConfig.issuer);
    expect(error.message).not.toContain(unsafeConfig.jwksUri);
    expect(() => new RemoteJwksInternalIdentityTokenVerifier(unsafeConfig)).toThrow(InternalIdentityConfigurationError);
  });

  it('uses bounded static verifier configuration and preserves normal verification with a small tolerance', async () => {
    const fixture = createInternalIdentityJwtFixture();
    const verifier = createStaticInternalIdentityTokenVerifier({
      issuer: TEST_GATEWAY_ISSUER,
      audience: TEST_BACKEND_AUDIENCE,
      jwks: fixture.jwks,
      clockToleranceSeconds: 1
    });

    await expect(verifier.verify({ authorization: `Bearer ${fixture.sign()}` })).resolves.toMatchObject({
      issuer: TEST_GATEWAY_ISSUER
    });
    await expect(
      internalIdentityTokenVerifierForTest.verify({
        authorization: `Bearer ${fixture.sign()}`,
        issuer: TEST_GATEWAY_ISSUER,
        audience: TEST_BACKEND_AUDIENCE,
        jwks: fixture.jwks,
        clockToleranceSeconds: MAX_INTERNAL_IDENTITY_CLOCK_TOLERANCE_SECONDS + 1
      })
    ).rejects.toBeInstanceOf(InternalIdentityConfigurationError);
    expect(() =>
      createStaticInternalIdentityTokenVerifier({
        issuer: TEST_GATEWAY_ISSUER,
        audience: TEST_BACKEND_AUDIENCE,
        jwks: fixture.jwks,
        clockToleranceSeconds: MAX_INTERNAL_IDENTITY_CLOCK_TOLERANCE_SECONDS + 1
      })
    ).toThrow(InternalIdentityConfigurationError);
  });
});

function captureError(callback: () => unknown): Error {
  try {
    callback();
  } catch (error) {
    return error as Error;
  }
  throw new Error('Expected callback to throw.');
}
