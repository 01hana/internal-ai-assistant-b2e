import request from 'supertest';
import { createCustomerConnectorRuntimeApplication } from '../../src/main';
import { validRuntimeEnvironment } from '../fixtures/runtime-environment';

describe('protected route activation boundary', () => {
  it('keeps both protected routes active after Phase 6', async () => {
    const app = await createCustomerConnectorRuntimeApplication(validRuntimeEnvironment());
    await app.init();
    try {
      await request(app.getHttpServer()).post('/v1/internal/connector-bindings')
        .set('Content-Type', 'application/json').set('Authorization', 'Bearer sentinel').send({ providerPayload: 'secret' }).expect(401);
      await request(app.getHttpServer()).post('/v1/connector/invocations')
        .set('Content-Type', 'application/json').set('X-Request-Id', 'req-route-activation')
        .set('Authorization', 'Bearer sentinel').send({ providerPayload: 'secret' }).expect(401);
    } finally {
      await app.close();
    }
  });
});
