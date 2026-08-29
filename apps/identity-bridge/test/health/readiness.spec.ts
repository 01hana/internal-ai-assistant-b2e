import { BridgeConfigService } from '../../src/config/bridge-config.service';
import { BridgeReadinessRegistry, BridgeReadinessService } from '../../src/health/readiness.service';
import { ExchangeReadinessInitializer } from '../../src/exchange/exchange.module';
import { ExchangeModule } from '../../src/exchange/exchange.module';
import { IdentityAdmissionService } from '../../src/idx/identity-admission.service';
import { IdxMenuDetailValidator } from '../../src/idx/menu-detail.validator';
import { IdxPermissionNormalizer } from '../../src/idx/permission-normalizer';
import { ScopeProjector } from '../../src/idx/scope-projector';
import { MenuDetailTransport } from '../../src/idx/transport/menu-detail.transport';
import { Test } from '@nestjs/testing';
import { BRIDGE_ENVIRONMENT } from '../../src/config/bridge-config.service';
import { bridgeEnvironment, rsaSigningFixture } from '../signing/signing-fixtures';
const valid = () => ({ BRIDGE_IDX_MENUDETAIL_URI: 'https://idx.test/menu', BRIDGE_IDX_ALLOWED_ENTRY: 'entry', BRIDGE_INTEGRATION_ID: 'integration', BRIDGE_HOST_APP: 'host', BRIDGE_ISSUER: 'issuer', BRIDGE_AUDIENCE: 'aud', BRIDGE_JWKS_PUBLIC_URI: 'https://bridge.example.test/jwks', BRIDGE_SIGNING_KEYS: '[{"kid":"key","status":"published","publicJwk":{}}]', IDX_DESTINATION_MODE: 'public_only', BRIDGE_TIMEOUT_MS: '1', BRIDGE_MAX_RESPONSE_BYTES: '1' });
describe('Bridge deferred readiness contract', () => {
  it('keeps invalid configuration not ready', () => {
    const readiness = new BridgeReadinessService(new BridgeConfigService({}), new BridgeReadinessRegistry());
    expect(readiness.snapshot()).toMatchObject({ configurationValid: false, ready: false, missing: expect.arrayContaining(['idxTransport', 'idxSemantics', 'signing', 'jwks', 'exchange']) });
    expect(JSON.stringify(readiness.getPublicReadiness())).not.toMatch(/idx|signing|jwks|configuration|secret|key/i);
  });
  it('computes internal readiness only after every declared dependency progresses', () => {
    const registry = new BridgeReadinessRegistry(); const readiness = new BridgeReadinessService(new BridgeConfigService(valid()), registry);
    expect(readiness.snapshot()).toMatchObject({ configurationValid: true, ready: false, missing: ['idxTransport', 'idxSemantics', 'signing', 'jwks', 'exchange'] });
    const dependencies = ['idxTransport', 'idxSemantics', 'signing', 'jwks', 'exchange'] as const;
    const initialStates = registry.snapshot();
    expect(Object.isFrozen(initialStates)).toBe(true);
    expect(initialStates).toEqual({ idxTransport: false, idxSemantics: false, signing: false, jwks: false, exchange: false });
    for (const [index, dependency] of dependencies.entries()) {
      registry.setReady(dependency, true);
      expect(readiness.snapshot()).toMatchObject({ ready: index === dependencies.length - 1, missing: dependencies.slice(index + 1) });
    }
    expect(readiness.snapshot()).toMatchObject({ configurationValid: true, ready: true, missing: [] });
  });
  it('requires genuine local components and never performs an IDX request while evaluating them', async () => {
    const registry = new BridgeReadinessRegistry();
    const transport = { execute: jest.fn() };
    const signing = { resolve: jest.fn().mockResolvedValue({ kid: 'key' }) };
    const jwks = { document: jest.fn().mockResolvedValue({ keys: [{ kid: 'key' }] }) };
    const configuration = new BridgeConfigService(valid());
    const initializer = new ExchangeReadinessInitializer(
      configuration, registry, transport as never,
      new IdxMenuDetailValidator(), new IdentityAdmissionService(configuration), new IdxPermissionNormalizer(), new ScopeProjector(),
      signing as never, jwks as never, { exchange: jest.fn() } as never
    );

    await initializer.onModuleInit();

    expect(transport.execute).not.toHaveBeenCalled();
    expect(signing.resolve).toHaveBeenCalledTimes(1);
    expect(jwks.document).toHaveBeenCalledTimes(1);
    expect(registry.snapshot()).toEqual({ idxTransport: true, idxSemantics: true, signing: true, jwks: true, exchange: true });
    expect(new BridgeReadinessService(new BridgeConfigService(valid()), registry).getPublicReadiness()).toMatchObject({ status: 'ready', runtimeDependencies: 'available', productionReady: true });
  });
  it('keeps readiness fail-closed when real signing or JWKS validation fails', async () => {
    const registry = new BridgeReadinessRegistry();
    const configuration = new BridgeConfigService(valid());
    const initializer = new ExchangeReadinessInitializer(
      configuration, registry, { execute: jest.fn() } as never,
      new IdxMenuDetailValidator(), new IdentityAdmissionService(configuration), new IdxPermissionNormalizer(), new ScopeProjector(),
      { resolve: jest.fn().mockRejectedValue(new Error('signing')) } as never,
      { document: jest.fn().mockResolvedValue({ keys: [] }) } as never,
      { exchange: jest.fn() } as never
    );
    await initializer.onModuleInit();
    expect(registry.snapshot()).toEqual({ idxTransport: true, idxSemantics: true, signing: false, jwks: false, exchange: false });
    expect(new BridgeReadinessService(new BridgeConfigService(valid()), registry).getPublicReadiness()).toMatchObject({ status: 'not_ready', productionReady: false });
  });
  it('turns public readiness green only after real key resolution, JWKS generation, and complete production composition', async () => {
    const fixture = rsaSigningFixture();
    const module = await Test.createTestingModule({ imports: [ExchangeModule] })
      .overrideProvider(BRIDGE_ENVIRONMENT).useValue(bridgeEnvironment([fixture.record]))
      .compile();
    const app = module.createNestApplication();
    const transport = app.get(MenuDetailTransport);
    const execute = jest.spyOn(transport, 'execute');
    await app.init();
    try {
      expect(execute).not.toHaveBeenCalled();
      expect(app.get(BridgeReadinessRegistry).snapshot()).toEqual({ idxTransport: true, idxSemantics: true, signing: true, jwks: true, exchange: true });
      expect(app.get(BridgeReadinessService).getPublicReadiness()).toMatchObject({ status: 'ready', runtimeDependencies: 'available', productionReady: true });
    } finally { await app.close(); }
  });
});
