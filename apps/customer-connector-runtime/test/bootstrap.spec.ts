import request from 'supertest';
import { createCustomerConnectorRuntimeApplication } from '../src/main';
import { validRuntimeEnvironment } from './fixtures/runtime-environment';

describe('Customer Connector Runtime bootstrap', () => {
  it('boots with health plus both fail-closed protected routes after Phase 6', async () => {
    const app = await createCustomerConnectorRuntimeApplication(validRuntimeEnvironment());
    await app.init();

    try {
      await request(app.getHttpServer()).get('/health').expect(200).expect(({ body }) => {
        expect(body).toMatchObject({ status: 'healthy', service: 'customer-connector-runtime' });
      });
      await request(app.getHttpServer()).get('/ready').expect(503).expect(({ body }) => {
        expect(body).toMatchObject({
          status: 'not_ready',
          service: 'customer-connector-runtime',
          runtimeDependencies: 'not_evaluated',
          productionReady: false
        });
      });
      await request(app.getHttpServer()).post('/v1/internal/connector-bindings').send({}).expect(401);
      await request(app.getHttpServer()).post('/v1/connector/invocations').send({}).expect(400);
    } finally {
      await app.close();
    }
  });
});
