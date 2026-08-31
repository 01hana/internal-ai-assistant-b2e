import { BridgeConfigService, parseBridgeConfiguration } from '../../src/config/bridge-config.service';

const valid = (): Record<string, unknown> => ({
  BRIDGE_IDX_MENUDETAIL_URI: 'https://idx.customer.test/menu', BRIDGE_IDX_ALLOWED_ENTRIES: '["entry-a","entry-b"]',
  BRIDGE_INTEGRATION_ID: 'integration-a', BRIDGE_HOST_APP: 'admin', BRIDGE_ISSUER: 'https://bridge.customer.test',
  BRIDGE_AUDIENCE: 'assistant-gateway', BRIDGE_JWKS_PUBLIC_URI: 'https://bridge.customer.test/.well-known/jwks.json',
  BRIDGE_SIGNING_KEYS: '[{"kid":"key-a","status":"published","publicJwk":{"kty":"RSA","kid":"key-a"}}]',
  IDX_DESTINATION_MODE: 'public_only', BRIDGE_TIMEOUT_MS: '5000', BRIDGE_MAX_RESPONSE_BYTES: '262144'
});

describe('Bridge configuration contract', () => {
  it('normalizes server-owned configuration without Customer authority', () => {
    const result = parseBridgeConfiguration(valid());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config).toMatchObject({ integrationId: 'integration-a', hostApp: 'admin', issuer: 'https://bridge.customer.test', audience: 'assistant-gateway', allowedEntries: ['entry-a', 'entry-b'] });
      expect(Object.isFrozen(result.config.allowedEntries)).toBe(true);
    }
  });
  it.each(['BRIDGE_IDX_MENUDETAIL_URI', 'BRIDGE_IDX_ALLOWED_ENTRIES', 'BRIDGE_INTEGRATION_ID', 'BRIDGE_HOST_APP', 'BRIDGE_ISSUER', 'BRIDGE_AUDIENCE', 'BRIDGE_JWKS_PUBLIC_URI', 'BRIDGE_SIGNING_KEYS', 'IDX_DESTINATION_MODE', 'BRIDGE_TIMEOUT_MS', 'BRIDGE_MAX_RESPONSE_BYTES'])('fails closed for missing or blank %s', (key) => {
    const input = valid(); delete input[key]; expect(parseBridgeConfiguration(input).ok).toBe(false);
    expect(parseBridgeConfiguration({ ...valid(), [key]: '  ' }).ok).toBe(false);
  });
  it.each([
    ['malformed JSON', '["entry-a"'],
    ['non-array JSON', '{"entry":"entry-a"}'],
    ['empty array', '[]'],
    ['non-string member', '["entry-a",7]'],
    ['blank member', '["entry-a","   "]'],
    ['leading whitespace', '["entry-a"," entry-b"]'],
    ['trailing whitespace', '["entry-a","entry-b "]'],
    ['control character', '["entry-a","entry\\u0000b"]'],
    ['exact duplicate', '["entry-a","entry-a"]']
  ])('rejects %s in the allowed-entry configuration', (_case, allowedEntries) => {
    expect(parseBridgeConfiguration({ ...valid(), BRIDGE_IDX_ALLOWED_ENTRIES: allowedEntries }).ok).toBe(false);
  });
  it('preserves exact case-sensitive distinct entries without normalization', () => {
    const result = parseBridgeConfiguration({ ...valid(), BRIDGE_IDX_ALLOWED_ENTRIES: '["entry","ENTRY"]' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.config.allowedEntries).toEqual(['entry', 'ENTRY']);
  });
  it('rejects the legacy singleton source whether supplied alone or with the plural source', () => {
    const legacyOnly = valid(); delete legacyOnly.BRIDGE_IDX_ALLOWED_ENTRIES; legacyOnly.BRIDGE_IDX_ALLOWED_ENTRY = 'entry-a';
    expect(parseBridgeConfiguration(legacyOnly).ok).toBe(false);
    expect(parseBridgeConfiguration({ ...valid(), BRIDGE_IDX_ALLOWED_ENTRY: 'entry-a' }).ok).toBe(false);
  });
  it('accepts signing-key metadata only and rejects private material or raw-key environment names', () => {
    expect(parseBridgeConfiguration(valid()).ok).toBe(true);
    expect(parseBridgeConfiguration({ ...valid(), BRIDGE_SIGNING_KEYS: '[{"kid":"","status":"active","publicJwk":{}}]' }).ok).toBe(false);
    expect(parseBridgeConfiguration({ ...valid(), BRIDGE_SIGNING_KEYS: '[{"kid":"a","status":"active","publicJwk":{"d":"secret"}}]' }).ok).toBe(false);
    expect(parseBridgeConfiguration({ ...valid(), BRIDGE_PRIVATE_KEY: 'secret' }).ok).toBe(false);
    expect(new BridgeConfigService({}).isValid).toBe(false);
  });
  it('accepts only V1 file key references without opening them', () => {
    const withReference = (keyReference: string) => ({ ...valid(), BRIDGE_SIGNING_KEYS: JSON.stringify([{ kid: 'key-a', status: 'active', publicJwk: {}, keyReference }]) });
    expect(parseBridgeConfiguration(withReference('file:/customer/secrets/bridge-key.pem')).ok).toBe(true);
    for (const reference of ['provider://bridge/key', 'kms://bridge/key', 'vault://bridge/key', 'secret-value', '-----BEGIN PRIVATE KEY-----']) expect(parseBridgeConfiguration(withReference(reference)).ok).toBe(false);
  });
});
