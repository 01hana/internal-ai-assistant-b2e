import { validateEnvironment } from '../../src/common/config/env.validation';

const validEnv = {
  DATABASE_URL: 'postgresql://assistant:assistant_dev_password@localhost:5432/assistant_dev',
  POSTGRES_USER: 'assistant',
  POSTGRES_PASSWORD: 'assistant_dev_password',
  POSTGRES_DB: 'assistant_dev',
  LLM_MODEL: 'local-placeholder-model',
  OPENAI_API_KEY: 'placeholder-openai-api-key',
  NODE_ENV: 'test'
};

describe('validateEnvironment', () => {
  it('accepts the required phase 1 environment variables', () => {
    expect(validateEnvironment(validEnv)).toMatchObject({
      DATABASE_URL: validEnv.DATABASE_URL,
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
});
