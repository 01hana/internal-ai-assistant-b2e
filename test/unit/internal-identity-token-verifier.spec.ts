import { resolve } from 'node:path';
import { inspect } from 'node:util';
import { createInternalIdentityJwtFixture, TEST_BACKEND_AUDIENCE, TEST_GATEWAY_ISSUER } from '../support/internal-identity-jwt.helper';
import { requireTargetModule } from '../support/dynamic-target-module.helper';

type VerifierUnderTest = {
  verify(input: { authorization?: string; issuer: string; audience: string; jwks: { keys: Array<Record<string, unknown>> } }): Promise<unknown>;
};

describe('internal identity token verifier (T006 contract)', () => {
  const fixture = createInternalIdentityJwtFixture();

  it.each([
    ['missing Authorization', undefined],
    ['malformed Bearer', 'Basic arbitrary'],
    ['damaged compact token', 'Bearer not-a-jwt'],
    ['invalid signature', `Bearer ${fixture.tamper(fixture.sign())}`],
    ['unknown kid', `Bearer ${fixture.sign({ header: { kid: 'unknown-kid' } })}`],
    ['wrong issuer', `Bearer ${fixture.sign({ claims: { iss: 'https://wrong.example' } })}`],
    ['wrong audience', `Bearer ${fixture.sign({ claims: { aud: 'wrong-audience' } })}`],
    ['unreasonable iat', `Bearer ${fixture.sign({ claims: { iat: 9_999_999_999 } })}`],
    ['expired exp', `Bearer ${fixture.sign({ claims: { exp: 1 } })}`],
    ['not-yet-valid nbf', `Bearer ${fixture.sign({ claims: { nbf: 9_999_999_999 } })}`],
    ['non-RS256 algorithm', `Bearer ${fixture.sign({ algorithm: 'HS256' })}`],
    ['algorithm none downgrade', `Bearer ${fixture.sign({ algorithm: 'none' })}`]
  ])('classifies %s as 401 IDENTITY_TOKEN_INVALID before claim mapping', async (_name, authorization) => {
    const verifier = loadVerifierUnderTest();

    await expect(
      verifier.verify({ authorization, issuer: TEST_GATEWAY_ISSUER, audience: TEST_BACKEND_AUDIENCE, jwks: fixture.jwks })
    ).rejects.toMatchObject({ status: 401, code: 'IDENTITY_TOKEN_INVALID' });
  });

  it('keeps complete-looking canonical claims in the 401 category when the signature is invalid', async () => {
    const originalToken = fixture.sign({ claims: fixture.canonicalClaims.customerA });
    const token = fixture.tamper(originalToken);

    expect(token).not.toBe(originalToken);
    expect(token.split('.')).toHaveLength(3);
    const verifier = loadVerifierUnderTest();

    await expect(
      verifier.verify({ authorization: `Bearer ${token}`, issuer: TEST_GATEWAY_ISSUER, audience: TEST_BACKEND_AUDIENCE, jwks: fixture.jwks })
    ).rejects.toMatchObject({ status: 401, code: 'IDENTITY_TOKEN_INVALID' });
  });

  it('does not expose token or key material in verifier errors', async () => {
    const verifier = loadVerifierUnderTest();
    const token = fixture.tamper(fixture.sign());
    const authorization = `Bearer ${token}`;
    const error = await verifier
      .verify({ authorization, issuer: TEST_GATEWAY_ISSUER, audience: TEST_BACKEND_AUDIENCE, jwks: fixture.jwks })
      .then(
        () => undefined,
        (rejection) => rejection
      );

    expect(error).toMatchObject({ status: 401, code: 'IDENTITY_TOKEN_INVALID' });
    const observableError = serializeObservableError(error);

    expect(observableError).not.toContain(token);
    expect(observableError).not.toContain(token.split('.')[2]);
    expect(observableError).not.toContain(authorization);
    expect(observableError).not.toMatch(
      /PRIVATE KEY|privateKey|privateMaterial|-----BEGIN|\bd\s*:|\bp\s*:|\bq\s*:|\bdp\s*:|\bdq\s*:|\bqi\s*:/i
    );
  });
});

function loadVerifierUnderTest(): VerifierUnderTest {
  const modulePath = resolve(__dirname, '../../src/identity/internal-identity-token-verifier');
  const target = requireTargetModule(
    modulePath,
    'T011/T012 not implemented: internal identity verifier is unavailable to T006 tests.'
  );
  const verifier = target.internalIdentityTokenVerifierForTest;
  if (!verifier) {
    throw new Error('Expected export internalIdentityTokenVerifierForTest is unavailable.');
  }
  return verifier as VerifierUnderTest;
}

function serializeObservableError(error: unknown): string {
  return inspect(error, {
    depth: null,
    getters: true,
    showHidden: true,
    sorted: true
  });
}
