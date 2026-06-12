import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request = require('supertest');
import { GlobalExceptionFilter } from '../../src/common/errors/global-exception.filter';
import { RequestIdInterceptor } from '../../src/common/request-id/request-id.interceptor';
import { ResponseEnvelopeInterceptor } from '../../src/common/response/response-envelope.interceptor';

describe('App bootstrap', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.DATABASE_URL = 'postgresql://assistant:assistant_dev_password@localhost:5432/assistant_dev';
    process.env.POSTGRES_USER = 'assistant';
    process.env.POSTGRES_PASSWORD = 'assistant_dev_password';
    process.env.POSTGRES_DB = 'assistant_dev';
    process.env.LLM_MODEL = 'local-placeholder-model';
    process.env.OPENAI_API_KEY = 'placeholder-openai-api-key';

    const { AppModule } = await import('../../src/app.module');
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ forbidNonWhitelisted: true, transform: true, whitelist: true }));
    app.useGlobalInterceptors(new RequestIdInterceptor(), new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('returns an enveloped 404 with requestId and no stack trace', async () => {
    const response = await request(app.getHttpServer()).get('/missing').set('x-request-id', 'req-e2e-smoke');

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      requestId: 'req-e2e-smoke',
      error: {
        code: 'NOT_FOUND'
      }
    });
    expect(JSON.stringify(response.body)).not.toContain('stack');
  });
});
