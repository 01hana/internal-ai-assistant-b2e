import type { SigningKeyPropagationProofInput, SigningKeyPropagationVerifier } from './signing-key-propagation-verifier';
import { IdentityServiceUnavailableError } from './identity-service-unavailable.error';

type LocalJwksPropagationVerifierDependencies = Readonly<{
  publicJwksUrl: string;
  fetch: (url: string) => Promise<Readonly<{ ok: boolean; json(): Promise<unknown> }>>;
}>;

/**
 * Local-only lifecycle proof. It verifies Gateway's real public JWKS response
 * and is deliberately never registered by GatewayModule.
 */
export class LocalJwksPropagationVerifier implements SigningKeyPropagationVerifier {
  constructor(private readonly dependencies: LocalJwksPropagationVerifierDependencies) {}

  verifyPublished(input: SigningKeyPropagationProofInput): Promise<void> {
    return this.verifyVisibleCandidate(input);
  }

  verifyActivated(input: SigningKeyPropagationProofInput): Promise<void> {
    return this.verifyVisibleCandidate(input);
  }

  private async verifyVisibleCandidate(input: SigningKeyPropagationProofInput): Promise<void> {
    try {
      const candidate = requirePublicCandidate(input);
      const response = await this.dependencies.fetch(this.dependencies.publicJwksUrl);
      if (!response.ok) throw new IdentityServiceUnavailableError();
      const document = await response.json();
      if (!isRecord(document) || !Array.isArray(document.keys)) throw new IdentityServiceUnavailableError();
      const matching = document.keys.find((entry) => isRecord(entry) && entry.kid === candidate.kid);
      if (!matching || !samePublicJwk(matching, candidate)) throw new IdentityServiceUnavailableError();
    } catch {
      throw new IdentityServiceUnavailableError();
    }
  }
}

function requirePublicCandidate(input: SigningKeyPropagationProofInput): Readonly<{ kty: 'RSA'; kid: string; alg: 'RS256'; use: 'sig'; n: string; e: string }> {
  if (!input || typeof input.kid !== 'string' || !input.kid.trim() || !isRecord(input.publicJwk)) throw new IdentityServiceUnavailableError();
  const jwk = input.publicJwk;
  if (jwk.kty !== 'RSA' || jwk.kid !== input.kid || jwk.alg !== 'RS256' || jwk.use !== 'sig' || !nonBlank(jwk.n) || !nonBlank(jwk.e) || hasPrivateMembers(jwk)) {
    throw new IdentityServiceUnavailableError();
  }
  return Object.freeze({ kty: 'RSA', kid: input.kid, alg: 'RS256', use: 'sig', n: jwk.n, e: jwk.e });
}

function samePublicJwk(value: Record<string, unknown>, candidate: Readonly<{ kty: string; kid: string; alg: string; use: string; n: string; e: string }>): boolean {
  return value.kty === candidate.kty && value.kid === candidate.kid && value.alg === candidate.alg && value.use === candidate.use && value.n === candidate.n && value.e === candidate.e && !hasPrivateMembers(value);
}

function hasPrivateMembers(value: Record<string, unknown>): boolean {
  return ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth'].some((field) => field in value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonBlank(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
