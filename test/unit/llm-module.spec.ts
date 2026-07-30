import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { AuditWriterService } from '../../src/audit/audit-writer.service';
import { EnvironmentVariables } from '../../src/common/config/env.validation';
import { LlmExecutionService } from '../../src/llm/llm-execution.service';
import { LlmModule } from '../../src/llm/llm.module';
import { OpenAiProvider } from '../../src/llm/openai/openai.provider';
import { PrismaService } from '../../src/prisma/prisma.service';

describe('LlmModule', () => {
  it('exposes LlmExecutionService as the feature-facing LLM entrypoint', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          ignoreEnvFile: true,
          isGlobal: true,
          load: [() => createConfigValues()]
        }),
        LlmModule
      ]
    })
      .overrideProvider(PrismaService)
      .useValue({
        db: {
          auditEvent: {
            create: jest.fn()
          }
        }
      })
      .overrideProvider(OpenAiProvider)
      .useValue({
        key: 'openai',
        generateAnswer: jest.fn(),
        classifyIntent: jest.fn(),
        summarize: jest.fn(),
        getMetadata: jest.fn().mockReturnValue({
          provider: 'openai',
          model: 'test-model',
          fallbackUsed: false
        })
      })
      .overrideProvider(AuditWriterService)
      .useValue({ append: jest.fn().mockResolvedValue({ id: 'audit-001' }) })
      .compile();

    expect(moduleRef.get(LlmExecutionService)).toBeInstanceOf(LlmExecutionService);
  });
});

function createConfigValues(): EnvironmentVariables {
  return {
    NODE_ENV: 'test',
    PORT: 3000,
    DATABASE_URL: 'postgresql://assistant:assistant_dev_password@localhost:5432/assistant_dev',
    POSTGRES_USER: 'assistant',
    POSTGRES_PASSWORD: 'assistant_dev_password',
    POSTGRES_DB: 'assistant_dev',
    LLM_PROVIDER: 'openai',
    LLM_MODEL: 'test-model',
    OPENAI_API_KEY: 'placeholder-openai-api-key',
    ENABLE_RUNTIME_DEBUG: false,
    ENABLE_REDIS: false,
    ENABLE_SWAGGER_DOCS: false,
    SWAGGER_PATH: 'docs',
    INTERNAL_IDENTITY_JWT_ISSUER: 'https://gateway.test.internal',
    INTERNAL_IDENTITY_JWT_AUDIENCE: 'internal-ai-assistant',
    INTERNAL_IDENTITY_JWKS_URI: 'https://gateway.test.internal/.well-known/jwks.json',
    INTERNAL_IDENTITY_JWT_CLOCK_TOLERANCE_SECONDS: 0,
    CORS_ALLOWED_ORIGINS: ''
  };
}
