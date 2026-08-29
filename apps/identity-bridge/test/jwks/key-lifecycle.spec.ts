import { BridgeConfigService } from '../../src/config/bridge-config.service';
import { KeyLifecycleService } from '../../src/jwks/key-lifecycle.service';
import { bridgeEnvironment, rsaSigningFixture } from '../signing/signing-fixtures';

describe('Bridge deployment key lifecycle', () => {
  const lifecycle = new KeyLifecycleService();

  it('requires exactly one active key', () => {
    const first = rsaSigningFixture('first');
    const second = rsaSigningFixture('second');
    expect(() => lifecycle.validateCurrent([{ ...first.record, status: 'published' }])).toThrow('bridge_jwks_invalid');
    expect(() => lifecycle.validateCurrent([first.record, second.record])).toThrow('bridge_jwks_invalid');
  });

  it.each([
    ['kty', 'EC'], ['alg', 'RS512'], ['use', 'enc'], ['kid', 'other-kid'], ['n', ''], ['e', '']
  ])('rejects invalid public JWK %s', (field, value) => {
    const fixture = rsaSigningFixture();
    expect(() => lifecycle.validateCurrent([{ ...fixture.record, publicJwk: { ...fixture.record.publicJwk, [field]: value } }])).toThrow('bridge_jwks_invalid');
  });

  it.each(['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k'])('rejects private JWK member %s', (field) => {
    const fixture = rsaSigningFixture();
    expect(() => lifecycle.validateCurrent([{ ...fixture.record, publicJwk: { ...fixture.record.publicJwk, [field]: 'private' } }])).toThrow('bridge_jwks_invalid');
  });

  it('rejects duplicate kids at the existing configuration boundary', () => {
    const fixture = rsaSigningFixture();
    const config = new BridgeConfigService(bridgeEnvironment([fixture.record, { ...fixture.record, status: 'published' }]));
    expect(config.validation).toEqual({ ok: false, category: 'signing_keys' });
  });

  it('accepts publish-before-active with the former active becoming retiring', () => {
    const oldKey = rsaSigningFixture('old-key');
    const newKey = rsaSigningFixture('new-key');
    const previous = [oldKey.record, { ...newKey.record, status: 'published' as const }];
    const next = [{ ...oldKey.record, status: 'retiring' as const }, newKey.record];
    expect(() => lifecycle.validateTransition(previous, next)).not.toThrow();
  });

  it('rejects direct activation and failure to retire the former active key', () => {
    const oldKey = rsaSigningFixture('old-key');
    const newKey = rsaSigningFixture('new-key');
    expect(() => lifecycle.validateTransition([oldKey.record], [{ ...oldKey.record, status: 'retiring' }, newKey.record])).toThrow('bridge_jwks_invalid');
    expect(() => lifecycle.validateTransition([oldKey.record, { ...newKey.record, status: 'published' }], [oldKey.record, newKey.record])).toThrow('bridge_jwks_invalid');
  });
});
