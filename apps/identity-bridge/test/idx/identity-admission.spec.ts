import { BridgeConfigService } from '../../src/config/bridge-config.service';
import { IdentityAdmissionService } from '../../src/idx/identity-admission.service';
import { IdxMenuDetailValidator } from '../../src/idx/menu-detail.validator';
import { parseNativeClaims } from '../../src/idx/native-claim-parser';
import { nativeClaims, response, token } from '../fixtures/idx-semantic.vectors';
const accepted = () => new IdxMenuDetailValidator().validate(response());
const config = configuration(['entry-a', 'entry-b']);
describe('post-acceptance identity admission', () => {
  it.each(['entry-a', 'entry-b'])('accepts allowed Entry %s only after accepted MenuDetail', (entry) => {
    expect(new IdentityAdmissionService(config).admit(accepted(), token({ ...nativeClaims, UUID_Entry: entry }))).toEqual({ subject: 'user-a', organization: 'company-a', entry });
  });
  it('supports a singleton allowed-entry set', () => {
    expect(new IdentityAdmissionService(configuration(['entry-a'])).admit(accepted(), token({ ...nativeClaims, UUID_Entry: 'entry-a' }))).toEqual({ subject: 'user-a', organization: 'company-a', entry: 'entry-a' });
  });
  it.each([token({ ...nativeClaims, UUID_User: 'other' }), token({ ...nativeClaims, UUID_Company: ['company-a'] }), token({ ...nativeClaims, UUID_Entry: 'other' }), 'a.!.c', 'a.eyJhIjpbXX0.c'])('rejects malformed or inadmissible native material', (credential) => expect(() => new IdentityAdmissionService(config).admit(accepted(), credential)).toThrow('idx_semantic_invalid'));
  it('cannot make direct decoded claims authoritative', () => { expect(parseNativeClaims(token({ ...nativeClaims, IsAdmin: true }))).toMatchObject(nativeClaims); expect(() => new IdentityAdmissionService(config).admit(undefined as never, token())).toThrow('idx_semantic_invalid'); });
  it.each(['sub', 'UUID_User', 'UUID_Company', 'UUID_Entry'] as const)('rejects every invalid %s claim representation', (field) => {
    for (const value of [undefined, null, 7, {}, [], '   ', 'bad\u0000value']) expect(() => new IdentityAdmissionService(config).admit(accepted(), token({ ...nativeClaims, [field]: value }))).toThrow('idx_semantic_invalid');
  });
  it.each([[[]], [['company-a']], [['company-a', 'company-b']]])('rejects UUID_Company arrays including one-element arrays', (company) => expect(() => new IdentityAdmissionService(config).admit(accepted(), token({ ...nativeClaims, UUID_Company: company }))).toThrow('idx_semantic_invalid'));
  it.each([{ sub: 'user-a', UUID_User: ' user-a' }, { sub: 'user-a ', UUID_User: 'user-a' }, { UUID_Entry: ' entry-a' }, { UUID_Entry: 'ENTRY-A' }, { UUID_Entry: [] }, { UUID_Entry: {} }])('requires exact subject/user and case-sensitive Entry membership', (override) => expect(() => new IdentityAdmissionService(config).admit(accepted(), token({ ...nativeClaims, ...override }))).toThrow('idx_semantic_invalid'));
  it('returns Entry only as admission anchor and preserves distinct subject and organization', () => expect(new IdentityAdmissionService(config).admit(accepted(), token({ sub: 'subject-sentinel', UUID_User: 'subject-sentinel', UUID_Company: 'organization-sentinel', UUID_Entry: 'entry-b' }))).toEqual({ subject: 'subject-sentinel', organization: 'organization-sentinel', entry: 'entry-b' }));
});

function configuration(allowedEntries: readonly string[]): BridgeConfigService {
  return new BridgeConfigService({ BRIDGE_IDX_MENUDETAIL_URI: 'https://idx.test/x', BRIDGE_IDX_ALLOWED_ENTRIES: JSON.stringify(allowedEntries), BRIDGE_INTEGRATION_ID: 'i', BRIDGE_HOST_APP: 'h', BRIDGE_ISSUER: 'issuer', BRIDGE_AUDIENCE: 'aud', BRIDGE_JWKS_PUBLIC_URI: 'https://bridge.test/jwks', BRIDGE_SIGNING_KEYS: '[{"kid":"k","status":"published","publicJwk":{}}]', IDX_DESTINATION_MODE: 'public_only', BRIDGE_TIMEOUT_MS: '1', BRIDGE_MAX_RESPONSE_BYTES: '1' });
}
