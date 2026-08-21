import { type IdentityProviderAdapter, type VerifyNativeCredentialInput, type VerifiedExternalIdentity, ManagedExchangeInfrastructureError } from '../domain/managed-exchange.domain';

/** Known provider shell pending an authoritative delegated verification contract. */
export class IdxDelegatedVerificationAdapter implements IdentityProviderAdapter {
  readonly providerType = 'idx_delegated';

  async verify(_input: VerifyNativeCredentialInput): Promise<VerifiedExternalIdentity> {
    throw new ManagedExchangeInfrastructureError();
  }
}
