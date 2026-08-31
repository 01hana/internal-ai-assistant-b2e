import { BridgeConfigService } from '../../src/config/bridge-config.service';
import type { RawMenuDetailResponse } from '../../src/idx/transport/menu-detail.transport';

export const nativeToken = 'native-token-sentinel-do-not-leak';

export function config(overrides: Record<string, unknown> = {}): BridgeConfigService {
  return new BridgeConfigService({
    BRIDGE_IDX_MENUDETAIL_URI: 'https://idx.customer.test/menu-detail',
    BRIDGE_IDX_ALLOWED_ENTRIES: '["entry"]', BRIDGE_INTEGRATION_ID: 'integration', BRIDGE_HOST_APP: 'host',
    BRIDGE_ISSUER: 'issuer', BRIDGE_AUDIENCE: 'aud', BRIDGE_JWKS_PUBLIC_URI: 'https://bridge.example.test/jwks',
    BRIDGE_SIGNING_KEYS: '[{"kid":"key","status":"published","publicJwk":{}}]',
    IDX_DESTINATION_MODE: 'public_only', BRIDGE_TIMEOUT_MS: '50', BRIDGE_MAX_RESPONSE_BYTES: '64',
    ...overrides
  });
}

export function response(body = '{"opaque":"value"}', overrides: Partial<RawMenuDetailResponse> = {}): RawMenuDetailResponse {
  return { statusCode: 200, headers: { 'content-type': 'application/json' }, body: bytes(body), ...overrides };
}

export async function* bytes(value: string): AsyncIterable<Uint8Array> {
  yield new TextEncoder().encode(value);
}
