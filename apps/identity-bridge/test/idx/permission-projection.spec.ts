import { IdxMenuDetailValidator } from '../../src/idx/menu-detail.validator';
import { IdxPermissionNormalizer } from '../../src/idx/permission-normalizer';
import { ScopeProjector } from '../../src/idx/scope-projector';
import { BridgeConfigService } from '../../src/config/bridge-config.service';
import { IdentityAdmissionService } from '../../src/idx/identity-admission.service';
import { menu, nativeClaims, permission, response, token } from '../fixtures/idx-semantic.vectors';
const config = new BridgeConfigService({ BRIDGE_IDX_MENUDETAIL_URI: 'https://idx.test/x', BRIDGE_IDX_ALLOWED_ENTRIES: '["entry"]', BRIDGE_INTEGRATION_ID: 'i', BRIDGE_HOST_APP: 'h', BRIDGE_ISSUER: 'issuer', BRIDGE_AUDIENCE: 'aud', BRIDGE_JWKS_PUBLIC_URI: 'https://bridge.test/jwks', BRIDGE_SIGNING_KEYS: '[{"kid":"k","status":"published","publicJwk":{}}]', IDX_DESTINATION_MODE: 'public_only', BRIDGE_TIMEOUT_MS: '1', BRIDGE_MAX_RESPONSE_BYTES: '1' });
describe('MenuDetail-only permission projection', () => {
  it('deduplicates and deterministically orders MenuDetail actions', () => {
    const menus = new IdxMenuDetailValidator().validate(response([menu({ MenuID: 'Z', MenuPermission: permission({ Delete: 'Y' }) }), menu({ MenuID: 'A', MenuPermission: permission({ Update: 'Y' }) }), menu({ MenuID: 'A', MenuPermission: permission({ Insert: 'Y' }) })]));
    expect(new ScopeProjector().project(new IdxPermissionNormalizer().normalize(menus))).toEqual(['menu:A:read', 'menu:A:insert', 'menu:A:update', 'menu:Z:read', 'menu:Z:delete']);
  });
  it('keeps hostile native privilege claims out of reduced identity material and MenuDetail scopes', () => {
    const menus = new IdxMenuDetailValidator().validate(response([menu({ MenuID: 'ORDERS', MenuPermission: permission({ Update: 'Y' }) })]));
    const hostile = token({ ...nativeClaims, UserType: 'SUPER_ADMIN', IsAdmin: true, Permissions: ['root:*', 'menu:FORGED:*'], Permission_Hash: 'forged-permission-hash' });
    const identity = new IdentityAdmissionService(config).admit(menus, hostile); const scopes = new ScopeProjector().project(new IdxPermissionNormalizer().normalize(menus));
    expect(identity).toEqual({ subject: 'user-a', organization: 'company-a', entry: 'entry' });
    expect(scopes).toEqual(['menu:ORDERS:read', 'menu:ORDERS:update']);
    expect(JSON.stringify(identity)).not.toMatch(/UserType|IsAdmin|Permissions|Permission_Hash|Customer|HostApp|integration/i);
    expect(scopes.join(',')).not.toMatch(/root|FORGED|SUPER_ADMIN|\*/);
  });
});
