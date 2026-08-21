import { ProductionJwksSourceRegistrationPolicy } from '../../upstream-auth/jwks-source-policy';
import type { ProviderInstancePolicy } from '../domain/managed-exchange.domain';

type RegisteredProviderEndpoint = Pick<ProviderInstancePolicy,
  'providerType' | 'endpointUri' | 'httpMethod' | 'credentialPlacement' | 'timeoutMilliseconds' | 'responseContractVersion'>;

/** Fixed V1 provider endpoint and request-shape policy. */
export class DelegatedEndpointPolicy {
  validate(input: RegisteredProviderEndpoint): URL {
    if (input.providerType !== 'delegated_http' || input.httpMethod !== 'POST' || input.credentialPlacement !== 'authorization_bearer' || input.responseContractVersion !== 'delegated-http/v1' || !Number.isInteger(input.timeoutMilliseconds) || input.timeoutMilliseconds < 1 || input.timeoutMilliseconds > 5_000) {
      throw new DelegatedEndpointPolicyError();
    }
    try {
      new ProductionJwksSourceRegistrationPolicy().validate(input.endpointUri);
      return new URL(input.endpointUri);
    } catch {
      throw new DelegatedEndpointPolicyError();
    }
  }
}

export class DelegatedEndpointPolicyError extends Error {
  constructor() { super('Registered delegated endpoint is not allowed.'); }
}
