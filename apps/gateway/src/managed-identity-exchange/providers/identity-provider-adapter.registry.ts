import type { IdentityProviderAdapter, IdentityProviderAdapterRegistry as AdapterRegistry } from '../domain/managed-exchange.domain';
import { DelegatedHttpV1Adapter } from './delegated-http-v1.adapter';
import { IdxDelegatedVerificationAdapter } from './idx-delegated-verification.adapter';

/** Fixed deployment adapter resolution. */
export class IdentityProviderAdapterRegistry implements AdapterRegistry {
  constructor(private readonly delegated: DelegatedHttpV1Adapter, private readonly idx: IdxDelegatedVerificationAdapter) {}

  resolve(providerType: string): IdentityProviderAdapter | undefined {
    if (providerType === 'delegated_http') return this.delegated;
    if (providerType === 'idx_delegated') return this.idx;
    return undefined;
  }
}
