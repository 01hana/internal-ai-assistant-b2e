import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { GlobalExceptionFilter } from '../../src/common/errors/global-exception.filter';
import { RequestIdInterceptor } from '../../src/common/request-id/request-id.interceptor';
import { ResponseEnvelopeInterceptor } from '../../src/common/response/response-envelope.interceptor';

export async function createUs1TestApp(): Promise<INestApplication> {
  process.env.DATABASE_URL = 'postgresql://assistant:assistant_dev_password@localhost:5432/assistant_dev';
  process.env.POSTGRES_USER = 'assistant';
  process.env.POSTGRES_PASSWORD = 'assistant_dev_password';
  process.env.POSTGRES_DB = 'assistant_dev';
  process.env.LLM_PROVIDER = 'openai';
  process.env.LLM_MODEL = 'local-placeholder-model';
  process.env.OPENAI_API_KEY = 'placeholder-openai-api-key';
  process.env.ENABLE_SWAGGER_DOCS = 'false';
  process.env.SWAGGER_PATH = 'docs';

  const { AppModule } = await import('../../src/app.module');
  const { PrismaService } = await import('../../src/prisma/prisma.service');
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule]
  })
    .overrideProvider(PrismaService)
    .useValue({
      onModuleInit: jest.fn(),
      onModuleDestroy: jest.fn(),
      db: {}
    })
    .compile();

  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ forbidNonWhitelisted: true, transform: true, whitelist: true }));
  app.useGlobalInterceptors(new RequestIdInterceptor(), new ResponseEnvelopeInterceptor());
  app.useGlobalFilters(new GlobalExceptionFilter());
  await app.init();

  return app;
}

export function createIdentityHeaders(overrides?: Partial<Record<string, string>>) {
  return {
    'x-request-id': 'req-us1-default',
    'x-actor-id': 'actor-001',
    'x-host-app': 'erp',
    'x-organization-id': 'org-001',
    'x-role': 'planner',
    'x-permission-scopes': 'orders:read,inventory:read',
    ...overrides
  };
}

export function parseSseResponse(text: string) {
  const chunks = text
    .split('\n\n')
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  return chunks.map((chunk) => {
    const eventMatch = chunk.match(/^event:\s*(.+)$/m);
    const dataMatch = chunk.match(/^data:\s*(.+)$/m);

    return {
      event: eventMatch?.[1],
      data: dataMatch ? JSON.parse(dataMatch[1]) : undefined
    };
  });
}
