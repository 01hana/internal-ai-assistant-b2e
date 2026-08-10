import { redactSecrets } from '../../../../src/common/logger/redaction.util';
import { createEphemeralRsaFixture } from '../signing/ephemeral-rsa.fixture';

describe('Internal token and signing-material redaction contract (T045)', () => {
  it('redacts an internal token, Authorization, private PEM, and private JWK from every generic safe projection', async () => {
    const fixture = await createEphemeralRsaFixture();
    const token = 'header.payload.signature-sentinel';
    const privateJwk = { kty: 'RSA', d: 'private-d', p: 'private-p', q: 'private-q', dp: 'private-dp', dq: 'private-dq', qi: 'private-qi' };
    const safe = redactSecrets({
      response: { authorization: `Bearer ${token}` },
      audit: { token, privateJwk },
      telemetry: { privateKeyPem: fixture.privatePem },
      loggerMetadata: { signingPrivateKey: fixture.privatePem, credential: 'credential-sentinel' },
      jwksOutput: { keys: [{ ...fixture.publicJwk, ...privateJwk }] }
    });

    const serialized = JSON.stringify(safe);
    [token, fixture.privatePem, 'private-d', 'private-p', 'private-q', 'private-dp', 'private-dq', 'private-qi', 'credential-sentinel'].forEach((secret) => {
      expect(serialized).not.toContain(secret);
    });
  });

  it('does not globally redact ordinary business d, p, or q fields', () => {
    expect(redactSecrets({ business: { d: 'domain', p: 'product', q: 'query' } })).toEqual({ business: { d: 'domain', p: 'product', q: 'query' } });
  });
});
