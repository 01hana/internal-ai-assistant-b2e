import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request = require('supertest');
import { GlobalExceptionFilter } from '../../src/common/errors/global-exception.filter';
import { RequestIdInterceptor } from '../../src/common/request-id/request-id.interceptor';
import { ResponseEnvelopeInterceptor } from '../../src/common/response/response-envelope.interceptor';

describe('App bootstrap', () => {
  let app: INestApplication;

  async function createApp(enableSwaggerDocs = false) {
    jest.resetModules();
    process.env.DATABASE_URL = 'postgresql://assistant:assistant_dev_password@localhost:5432/assistant_dev';
    process.env.POSTGRES_USER = 'assistant';
    process.env.POSTGRES_PASSWORD = 'assistant_dev_password';
    process.env.POSTGRES_DB = 'assistant_dev';
    process.env.LLM_PROVIDER = 'openai';
    process.env.LLM_MODEL = 'local-placeholder-model';
    process.env.OPENAI_API_KEY = 'placeholder-openai-api-key';
    process.env.ENABLE_SWAGGER_DOCS = String(enableSwaggerDocs);
    process.env.SWAGGER_PATH = 'docs';
    process.env.INTERNAL_IDENTITY_JWT_ISSUER = 'https://gateway.test.internal';
    process.env.INTERNAL_IDENTITY_JWT_AUDIENCE = 'internal-ai-assistant';
    process.env.INTERNAL_IDENTITY_JWKS_URI = 'https://gateway.test.internal/.well-known/jwks.json';

    const { AppModule } = await import('../../src/app.module');
    const { setupSwagger } = await import('../../src/common/docs/swagger.setup');
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

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ forbidNonWhitelisted: true, transform: true, whitelist: true }));
    app.useGlobalInterceptors(new RequestIdInterceptor(), new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new GlobalExceptionFilter());
    if (enableSwaggerDocs) {
      setupSwagger(app, { path: 'docs' });
    }
    await app.init();

    return app;
  }

  beforeAll(async () => {
    app = await createApp(false);
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('returns an enveloped 404 with requestId and no stack trace', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/missing').set('x-request-id', 'req-e2e-smoke');

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      requestId: 'req-e2e-smoke',
      error: {
        code: 'NOT_FOUND'
      }
    });
    expect(JSON.stringify(response.body)).not.toContain('stack');
  });

  it('does not expose Swagger docs when disabled', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/docs').set('x-request-id', 'req-docs-disabled');

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      requestId: 'req-docs-disabled',
      error: {
        code: 'NOT_FOUND'
      }
    });
  });

  it('serves Swagger docs under the global API prefix when enabled', async () => {
    const swaggerApp = await createApp(true);

    try {
      const response = await request(swaggerApp.getHttpServer()).get('/api/v1/docs');

      expect(response.status).toBe(200);
      expect(response.text).toContain('Swagger UI');
    } finally {
      await swaggerApp.close();
    }
  });
});
