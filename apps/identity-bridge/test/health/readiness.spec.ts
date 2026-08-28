import { BridgeConfigService } from '../../src/config/bridge-config.service';
import { BridgeReadinessRegistry, BridgeReadinessService } from '../../src/health/readiness.service';
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
});
