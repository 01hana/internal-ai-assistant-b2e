import { IdentityServiceUnavailableError } from './identity-service-unavailable.error';

export type SigningKeyPropagationProofInput = Readonly<{ kid: string; publicJwk: unknown }>;

/**
 * Narrow rotation safety boundary. Phase 6 does not provide a Backend transport
 * or business request; a concrete Backend Remote-JWKS acceptance probe remains
 * a later verification concern.
 */
export type SigningKeyPropagationVerifier = Readonly<{
  verifyPublished(input: SigningKeyPropagationProofInput): Promise<void>;
  verifyActivated(input: SigningKeyPropagationProofInput): Promise<void>;
}>;

/**
 * T061 owns concrete Backend Remote-JWKS acceptance evidence. Until then, an
 * absent operational probe must deny rather than claiming key propagation.
 */
export class UnavailableSigningKeyPropagationVerifier implements SigningKeyPropagationVerifier {
  async verifyPublished(_input: SigningKeyPropagationProofInput): Promise<void> {
    throw new IdentityServiceUnavailableError();
  }

  async verifyActivated(_input: SigningKeyPropagationProofInput): Promise<void> {
    throw new IdentityServiceUnavailableError();
  }
}
