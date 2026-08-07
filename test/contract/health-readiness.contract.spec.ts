import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { PrismaService } from '../../src/prisma/prisma.service';
import { createUs1TestAppWithState, Us1TestState } from '../support/us1-test-app.helper';

describe('health and readiness contract', () => {
  let app: INestApplication;
  let state: Us1TestState;

  beforeEach(async () => {
    const testApp = await createUs1TestAppWithState();
    app = testApp.app;
    state = testApp.state;
  });

  afterEach(async () => {
    await app.close();
  });

  it('reports process liveness without requiring an identity context', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        requestId: expect.any(String),
        data: expect.objectContaining({
          status: 'healthy',
          service: 'internal-assistant-core',
          timestamp: expect.any(String)
        })
      })
    );
  });

  it('reports all core dependencies as healthy when probes succeed', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/readiness')
      .set('x-request-id', 'req-health-readiness-healthy');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        requestId: 'req-health-readiness-healthy',
        data: expect.objectContaining({
          status: 'healthy',
          service: 'internal-assistant-core',
          timestamp: expect.any(String),
          dependencies: {
            database: expect.objectContaining({ status: 'healthy', checkedAt: expect.any(String), durationMs: expect.any(Number) }),
            llm: expect.objectContaining({ status: 'healthy', checkedAt: expect.any(String), durationMs: expect.any(Number) }),
            retrieval: expect.objectContaining({ status: 'healthy', checkedAt: expect.any(String), durationMs: expect.any(Number) }),
            connector: expect.objectContaining({ status: 'healthy', checkedAt: expect.any(String), durationMs: expect.any(Number) }),
            approval_workflow: expect.objectContaining({ status: 'healthy', checkedAt: expect.any(String), durationMs: expect.any(Number) })
          }
        })
      })
    );
  });

  it('reports degraded readiness with a safe connector reason when the registry has no active mock tools', async () => {
    state.toolDefinitions.length = 0;

    const response = await request(app.getHttpServer())
      .get('/api/v1/readiness')
      .set('x-request-id', 'req-health-readiness-degraded');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        requestId: 'req-health-readiness-degraded',
        data: expect.objectContaining({
          status: 'degraded',
          dependencies: expect.objectContaining({
            connector: expect.objectContaining({
              status: 'degraded',
              reason: 'connector_registry_empty'
            })
          })
        })
      })
    );
  });

  it('reports unavailable readiness for a database probe failure without exposing raw failure details', async () => {
    const prisma = app.get(PrismaService) as unknown as { db: { $queryRaw: jest.Mock } };
    prisma.db.$queryRaw.mockRejectedValueOnce(new Error('postgresql://user:database-password@db.internal/assistant'));

    const response = await request(app.getHttpServer())
      .get('/api/v1/readiness')
      .set('x-request-id', 'req-health-readiness-unavailable');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        requestId: 'req-health-readiness-unavailable',
        data: expect.objectContaining({
          status: 'unavailable',
          dependencies: expect.objectContaining({
            database: expect.objectContaining({
              status: 'unavailable',
              reason: 'database_unreachable'
            })
          })
        })
      })
    );
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain('postgresql://');
    expect(serialized).not.toContain('database-password');
    expect(serialized).not.toContain('placeholder-openai-api-key');
    expect(serialized).not.toContain('connectorSecret');
    expect(serialized).not.toContain('stack');
  });
});
