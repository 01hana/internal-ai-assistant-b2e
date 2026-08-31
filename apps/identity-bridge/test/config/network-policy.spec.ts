import { parseBridgeConfiguration } from '../../src/config/bridge-config.service';

const base = (): Record<string, unknown> => ({ BRIDGE_IDX_MENUDETAIL_URI: 'https://10.0.0.5/menu', BRIDGE_IDX_ALLOWED_ENTRIES: '["entry"]', BRIDGE_INTEGRATION_ID: 'integration', BRIDGE_HOST_APP: 'host', BRIDGE_ISSUER: 'issuer', BRIDGE_AUDIENCE: 'aud', BRIDGE_JWKS_PUBLIC_URI: 'https://bridge.example.test/jwks', BRIDGE_SIGNING_KEYS: '[{"kid":"k","status":"published","publicJwk":{}}]', IDX_DESTINATION_MODE: 'public_only', BRIDGE_TIMEOUT_MS: '1', BRIDGE_MAX_RESPONSE_BYTES: '1' });
describe('Bridge network configuration contract', () => {
  it('enforces HTTPS URL and public JWKS topology syntax only', () => {
    expect(parseBridgeConfiguration(base()).ok).toBe(true);
    for (const value of ['http://idx.test', 'https://user:pass@idx.test/x', 'https://idx.test/x#fragment']) expect(parseBridgeConfiguration({ ...base(), BRIDGE_IDX_MENUDETAIL_URI: value }).ok).toBe(false);
    for (const value of ['http://bridge.test/jwks', 'https://localhost/jwks', 'https://localhost./jwks', 'https://foo.localhost./jwks', 'https://127.0.0.1/jwks', 'https://10.0.0.1/jwks', 'https://[::1]/jwks', 'https://[fc00::1]/jwks']) expect(parseBridgeConfiguration({ ...base(), BRIDGE_JWKS_PUBLIC_URI: value }).ok).toBe(false);
    expect(parseBridgeConfiguration({ ...base(), BRIDGE_JWKS_PUBLIC_URI: 'https://bridge.customer.example/.well-known/jwks.json' }).ok).toBe(true);
  });
  it('normalizes modes, CIDRs, bounds, and exact HTTPS origins without network activity', () => {
    const allowed = parseBridgeConfiguration({ ...base(), IDX_DESTINATION_MODE: 'allowlisted_networks', IDX_ALLOWED_CIDRS: '10.0.0.0/8,fd00::/8', BRIDGE_ALLOWED_ORIGINS: 'https://spa.test,https://spa.test' });
    expect(allowed.ok).toBe(true); if (allowed.ok) expect(allowed.config.allowedOrigins).toEqual(['https://spa.test']);
    for (const input of [{ IDX_DESTINATION_MODE: 'other' }, { IDX_DESTINATION_MODE: 'allowlisted_networks' }, { IDX_ALLOWED_CIDRS: 'bad' }, { BRIDGE_TIMEOUT_MS: '0' }, { BRIDGE_MAX_RESPONSE_BYTES: '262145' }, { BRIDGE_ALLOWED_ORIGINS: 'https://spa.test/path' }]) expect(parseBridgeConfiguration({ ...base(), ...input }).ok).toBe(false);
  });
});
