import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BridgeConfigService } from '../../src/config/bridge-config.service'; import { IdentityAdmissionService } from '../../src/idx/identity-admission.service'; import { IdxMenuDetailValidator } from '../../src/idx/menu-detail.validator'; import { menu, nativeClaims, permission, response, token } from '../fixtures/idx-semantic.vectors';
const config = new BridgeConfigService({ BRIDGE_IDX_MENUDETAIL_URI: 'https://idx.test/x', BRIDGE_IDX_ALLOWED_ENTRY: 'entry', BRIDGE_INTEGRATION_ID: 'i', BRIDGE_HOST_APP: 'h', BRIDGE_ISSUER: 'issuer', BRIDGE_AUDIENCE: 'aud', BRIDGE_JWKS_PUBLIC_URI: 'https://bridge.test/jwks', BRIDGE_SIGNING_KEYS: '[{"kid":"k","status":"published","publicJwk":{}}]', IDX_DESTINATION_MODE: 'public_only', BRIDGE_TIMEOUT_MS: '1', BRIDGE_MAX_RESPONSE_BYTES: '1' });
describe('IDX semantic security boundary', () => {
  it('contains no local signature, central authority, signing, or exchange implementation', () => {
    const root = join(__dirname, '../../src/idx'); const source = ['menu-detail.validator.ts', 'native-claim-parser.ts', 'identity-admission.service.ts', 'permission-normalizer.ts', 'scope-projector.ts'].map((file) => readFileSync(join(root, file), 'utf8')).join('\n');
    expect(source).not.toMatch(/ES512|JWKS|verify\(|jose|sign\(|Gateway|CustomerScope|IntegrationBinding|roles|POST\s*\(|exchange/i);
  });
  it.each([{ ...response([]), Code: 500 }, { ...response([]), Data: [{}] }])('never permits native identity when MenuDetail is unaccepted', (raw) => {
    const validator = new IdxMenuDetailValidator(); expect(() => validator.validate(raw)).toThrow('idx_semantic_invalid'); expect(() => new IdentityAdmissionService(config).admit(undefined as never, token(nativeClaims))).toThrow('idx_semantic_invalid');
  });
  it('does not establish post-acceptance local authority from native JWT header algorithm or kid', () => {
    const menus = new IdxMenuDetailValidator().validate(response());
    for (const header of [{ alg: 'ES512' }, { alg: 'none' }, { alg: 'ES512', kid: 'forged-kid' }]) { const credential = `${Buffer.from(JSON.stringify(header)).toString('base64url')}.${token(nativeClaims).split('.')[1]}.x`; expect(new IdentityAdmissionService(config).admit(menus, credential)).toEqual({ subject: 'user-a', organization: 'company-a', entry: 'entry' }); }
  });
  it('never exposes raw native-claim or MenuDetail sentinels in reduced results or failures', () => {
    const raw = response([menu({ UUID: 'raw-menu-sentinel', Memo: 'raw-memo-sentinel', MenuPermission: permission({ UUID: 'raw-permission-sentinel', Memo: 'raw-permission-memo' }) })]);
    const menus = new IdxMenuDetailValidator().validate(raw); const identity = new IdentityAdmissionService(config).admit(menus, token({ ...nativeClaims, rawClaim: 'raw-native-sentinel' }));
    expect(JSON.stringify({ menus, identity })).not.toMatch(/raw-(menu|memo|permission|native)-sentinel/);
    try { new IdxMenuDetailValidator().validate(response([menu({ UUID: 'raw-failure-sentinel', MenuPermission: permission({ Update: 'bad' }) })])); } catch (error) { expect(`${error}${JSON.stringify(error)}`).not.toContain('raw-failure-sentinel'); }
  });
});
