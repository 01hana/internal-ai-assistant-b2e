import { resolve } from 'node:path';

const targetPath = resolve(__dirname, '../../src/signing/local-jwks-propagation-verifier.ts');

describe('local JWKS signing-key propagation verifier', () => {
  const candidate = Object.freeze({ kty: 'RSA', kid: 'local-kid', alg: 'RS256', use: 'sig', n: 'local-modulus', e: 'AQAB' });

  it('accepts an exact public candidate exposed by Gateway JWKS', async () => {
    const verifier = createVerifier([{ ...candidate }]);
    await expect(verifier.verifyPublished({ kid: candidate.kid, publicJwk: candidate })).resolves.toBeUndefined();
    await expect(verifier.verifyActivated({ kid: candidate.kid, publicJwk: candidate })).resolves.toBeUndefined();
  });

  it.each([
    ['missing candidate', []],
    ['wrong algorithm', [{ ...candidate, alg: 'RS512' }]],
    ['wrong public material', [{ ...candidate, n: 'different-modulus' }]],
    ['private JWK member', [{ ...candidate, d: 'private-material' }]]
  ])('fails closed when Gateway JWKS has %s', async (_label, keys) => {
    const verifier = createVerifier(keys);
    await expect(verifier.verifyPublished({ kid: candidate.kid, publicJwk: candidate })).rejects.toMatchObject(genericUnavailable());
  });

  it('fails closed when the Gateway JWKS request is unavailable', async () => {
    const { LocalJwksPropagationVerifier } = loadTarget();
    const verifier = new LocalJwksPropagationVerifier({
      publicJwksUrl: 'http://127.0.0.1:4000/.well-known/jwks.json',
      fetch: async () => { throw new Error('network diagnostic'); }
    });

    await expect(verifier.verifyPublished({ kid: candidate.kid, publicJwk: candidate })).rejects.toMatchObject(genericUnavailable());
  });
});

function createVerifier(keys: readonly Record<string, unknown>[]) {
  const { LocalJwksPropagationVerifier } = loadTarget();
  return new LocalJwksPropagationVerifier({
    publicJwksUrl: 'http://127.0.0.1:4000/.well-known/jwks.json',
    fetch: async () => ({ ok: true, json: async () => ({ keys }) })
  });
}

function loadTarget(): { LocalJwksPropagationVerifier: new (input: unknown) => { verifyPublished(input: unknown): Promise<void>; verifyActivated(input: unknown): Promise<void> } } {
  // The test intentionally names the required local-only production surface.
  const target = require(targetPath) as { LocalJwksPropagationVerifier?: new (input: unknown) => { verifyPublished(input: unknown): Promise<void>; verifyActivated(input: unknown): Promise<void> } };
  if (!target.LocalJwksPropagationVerifier) throw new Error('Required local JWKS propagation verifier production surface missing.');
  return { LocalJwksPropagationVerifier: target.LocalJwksPropagationVerifier };
}

function genericUnavailable() {
  return { status: 503, code: 'IDENTITY_SERVICE_UNAVAILABLE', message: 'Identity service is unavailable.' };
}
