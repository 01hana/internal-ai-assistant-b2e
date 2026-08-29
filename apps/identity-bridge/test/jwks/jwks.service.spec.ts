import { JwksService } from '../../src/jwks/jwks.service';
import { KeyLifecycleService } from '../../src/jwks/key-lifecycle.service';
import { ActiveKeyResolver } from '../../src/signing/active-key.resolver';
import { rsaSigningFixture, signingConfig } from '../signing/signing-fixtures';

describe('Bridge public JWKS service', () => {
  it('publishes frozen public-only lifecycle keys sorted by kid', async () => {
    const active = rsaSigningFixture('middle-active');
    const published = rsaSigningFixture('alpha-published');
    const retiring = rsaSigningFixture('zulu-retiring');
    const records = [
      { ...retiring.record, status: 'retiring' as const, keyReference: 'file:/missing/retiring-private.pem' },
      active.record,
      { ...published.record, status: 'published' as const, keyReference: 'file:/missing/published-private.pem' }
    ];
    const config = signingConfig(records);
    const service = new JwksService(config, new KeyLifecycleService(), new ActiveKeyResolver(config));

    const document = await service.document();
    expect(document.keys.map((key) => key.kid)).toEqual(['alpha-published', 'middle-active', 'zulu-retiring']);
    for (const key of document.keys) {
      expect(Object.keys(key).sort()).toEqual(['alg', 'e', 'kid', 'kty', 'n', 'use']);
      expect(key).toMatchObject({ kty: 'RSA', alg: 'RS256', use: 'sig' });
      expect(JSON.stringify(key)).not.toMatch(/keyReference|status|privateKey|PEM|customer|UUID|MenuDetail|"(?:d|p|q|dp|dq|qi|oth|k)"/i);
      expect(Object.isFrozen(key)).toBe(true);
    }
    expect(Object.isFrozen(document.keys)).toBe(true);
    expect(Object.isFrozen(document)).toBe(true);
    expect(() => (document.keys as unknown as unknown[]).push({})).toThrow();
  });

  it('returns undefined for unknown and removed keys without mutable cache state', async () => {
    const active = rsaSigningFixture('active');
    const removed = rsaSigningFixture('removed');
    const firstConfig = signingConfig([active.record, { ...removed.record, status: 'retiring' as const }]);
    const first = new JwksService(firstConfig, new KeyLifecycleService(), new ActiveKeyResolver(firstConfig));
    expect(await first.findByKid('removed')).toBeDefined();
    expect(await first.findByKid('unknown')).toBeUndefined();

    const nextConfig = signingConfig([active.record]);
    const next = new JwksService(nextConfig, new KeyLifecycleService(), new ActiveKeyResolver(nextConfig));
    expect(await next.findByKid('removed')).toBeUndefined();
  });
});
