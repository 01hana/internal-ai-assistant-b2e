import { TestingModule, Test } from '@nestjs/testing';
import { createStaticInternalIdentityTokenVerifier } from '../../src/identity/internal-identity-token-verifier';
import { IdentityModule } from '../../src/identity/identity.module';
import { INTERNAL_IDENTITY_CONFIG, INTERNAL_IDENTITY_TOKEN_VERIFIER } from '../../src/identity/identity-token.types';

export const INTERNAL_IDENTITY_TEST_CONFIG = Symbol('INTERNAL_IDENTITY_TEST_CONFIG');

export type InternalIdentityTestConfig = {
  issuer: string;
  audience: string;
  jwks: { readonly keys: ReadonlyArray<Readonly<Record<string, unknown>>> };
};

export type InternalIdentityTestingModule = {
  moduleRef: TestingModule;
  internalIdentity: InternalIdentityTestConfig;
};

export function createInternalIdentityTestConfig(
  input: InternalIdentityTestConfig
): InternalIdentityTestConfig {
  const forbiddenPrivateJwkFields = ['d', 'p', 'q', 'dp', 'dq', 'qi', 'k'];
  const keys = input.jwks.keys.map((key) => {
    for (const field of forbiddenPrivateJwkFields) {
      if (field in key) {
        throw new Error('Test internal identity JWKS must contain public JWK material only.');
      }
    }
    return Object.freeze({ ...key });
  });

  return Object.freeze({
    issuer: input.issuer,
    audience: input.audience,
    jwks: Object.freeze({ keys: Object.freeze(keys) })
  });
}

export async function createInternalIdentityTestingModule(
  input: InternalIdentityTestConfig
): Promise<InternalIdentityTestingModule> {
  const internalIdentity = createInternalIdentityTestConfig(input);
  process.env.DATABASE_URL ??= 'postgresql://assistant:assistant@localhost:5432/assistant_test';
  process.env.POSTGRES_USER ??= 'assistant';
  process.env.POSTGRES_PASSWORD ??= 'assistant';
  process.env.POSTGRES_DB ??= 'assistant_test';
  process.env.LLM_MODEL ??= 'test-model';
  process.env.OPENAI_API_KEY ??= 'test-api-key';
  process.env.INTERNAL_IDENTITY_JWT_ISSUER = internalIdentity.issuer;
  process.env.INTERNAL_IDENTITY_JWT_AUDIENCE = internalIdentity.audience;
  process.env.INTERNAL_IDENTITY_JWKS_URI = 'https://gateway.test.internal/.well-known/jwks.json';
  const moduleRef = await Test.createTestingModule({
    imports: [IdentityModule],
    providers: [{ provide: INTERNAL_IDENTITY_TEST_CONFIG, useValue: internalIdentity }]
  })
    .overrideProvider(INTERNAL_IDENTITY_CONFIG)
    .useValue({
      issuer: internalIdentity.issuer,
      audience: internalIdentity.audience,
      jwksUri: 'https://gateway.test.internal/.well-known/jwks.json',
      clockToleranceSeconds: 0
    })
    .overrideProvider(INTERNAL_IDENTITY_TOKEN_VERIFIER)
    .useValue(createStaticInternalIdentityTokenVerifier(internalIdentity))
    .compile();

  return { moduleRef, internalIdentity };
}
