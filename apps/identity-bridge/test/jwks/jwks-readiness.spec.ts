import { Test } from '@nestjs/testing';
import { BRIDGE_ENVIRONMENT } from '../../src/config/bridge-config.service';
import { BridgeReadinessRegistry, BridgeReadinessService } from '../../src/health/readiness.service';
import { JwksModule } from '../../src/jwks/jwks.module';
import { bridgeEnvironment, rsaSigningFixture } from '../signing/signing-fixtures';

describe('Bridge JWKS capability readiness', () => {
  it('marks only JWKS available while overall and public readiness stay not-ready', async () => {
    const fixture = rsaSigningFixture();
    const module = await Test.createTestingModule({ imports: [JwksModule] })
      .overrideProvider(BRIDGE_ENVIRONMENT).useValue(bridgeEnvironment([fixture.record]))
      .compile();
    const app = module.createNestApplication();
    await app.init();
    try {
      const registry = app.get(BridgeReadinessRegistry);
      const readiness = app.get(BridgeReadinessService);
      expect(registry.snapshot()).toEqual({ idxTransport: false, idxSemantics: false, signing: false, jwks: true, exchange: false });
      expect(readiness.snapshot()).toMatchObject({ configurationValid: true, ready: false, missing: ['idxTransport', 'idxSemantics', 'signing', 'exchange'] });
      expect(readiness.getPublicReadiness()).toMatchObject({ status: 'not_ready', productionReady: false });
    } finally {
      await app.close();
    }
  });
});
