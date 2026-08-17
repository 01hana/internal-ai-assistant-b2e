import { ProductionJwksSourceRegistrationPolicy, assertPublicDestination } from '../../src/upstream-auth/jwks-source-policy';

describe('JWKS source policy (T021/T022/T027)', () => {
  const policy = new ProductionJwksSourceRegistrationPolicy();
  it.each(['http://issuer.test/jwks', 'https://user:pass@issuer.test/jwks', 'https://issuer.test/jwks#x', 'https://localhost/jwks', 'https://localhost./jwks', 'https://foo.localhost./jwks', 'https://127.0.0.1/jwks', 'https://[::1]/jwks', 'https://[fc00::1]/jwks'])('rejects unsafe registered source %s', (value) => expect(() => policy.validate(value)).toThrow());
  it.each(['127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.0.1', '169.254.1.1', '0.0.0.0', '192.0.2.1', '198.18.0.1', '198.51.100.1', '203.0.113.1', '224.0.0.1', '::1', '::', 'fc00::1', 'fe80::1', 'ff00::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1'])('rejects unsafe resolved address %s', (address) => expect(() => assertPublicDestination([address])).toThrow());
  it('rejects mixed DNS answers and permits all-public answers', () => {
    expect(() => assertPublicDestination(['8.8.8.8', '10.0.0.1'])).toThrow();
    expect(() => assertPublicDestination(['8.8.8.8', '1.1.1.1'])).not.toThrow();
  });
});
