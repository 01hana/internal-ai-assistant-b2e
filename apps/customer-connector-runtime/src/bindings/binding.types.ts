import type { ConnectorBindingTrustedContextV1, ConnectorErrorCode } from '@internal-ai-assistant/connector-runtime-contract';

export const BINDING_REFERENCE_RANDOM_BYTES = 32;
export const BINDING_MAX_TTL_SECONDS = 120;
export const BINDING_FALLBACK_TTL_SECONDS = 60;
export const BINDING_MIN_TTL_SECONDS = 15;
export const BINDING_PROVIDER_EXPIRY_SAFETY_SECONDS = 15;
export const BINDING_PROVIDER_METADATA_MAX_BYTES = 4_096;
export const MAX_CONCURRENT_BINDING_LEASES = 4;

export interface BindingStoreLimits {
  readonly maxEntries: number;
  readonly scopeMaxEntries: number;
  readonly sweepBatchSize: number;
}

export interface BindingMintInput {
  readonly trustedContext: ConnectorBindingTrustedContextV1;
  readonly bootstrapProviderKey: string;
  readonly credentialProviderKey: string;
  readonly opaqueCredentialHandle: string;
  readonly credentialGeneration: string;
  readonly providerExpiresAt?: number;
  readonly providerMetadata: unknown;
}

export interface BindingResolutionExpectation {
  readonly trustedContext: ConnectorBindingTrustedContextV1;
  readonly bootstrapProviderKey: string;
  readonly credentialProviderKey: string;
  readonly bindingGeneration?: number;
  readonly credentialGeneration?: string;
}

export interface InvocationBindingExpectation {
  readonly trustedContext: ConnectorBindingTrustedContextV1;
}

export interface ProtectedBindingView {
  readonly trustedContext: ConnectorBindingTrustedContextV1;
  readonly bootstrapProviderKey: string;
  readonly credentialProviderKey: string;
  readonly opaqueCredentialHandle: string;
  readonly credentialGeneration: string;
  readonly providerMetadata: object;
  readonly bindingGeneration: number;
  readonly expiresAt: number;
}

export type BindingFailureCode = Extract<ConnectorErrorCode,
  'CONNECTOR_BINDING_INVALID' | 'CONNECTOR_BINDING_BUSY' | 'CONNECTOR_UNAVAILABLE'>;
export type BindingResult<T> = Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; code: BindingFailureCode }>;

export type BindingRevocationReason = 'administrative' | 'provider_rejected' | 'generation_replaced' | 'expired' | 'shutdown' | 'mint_failed';

export interface StoredConnectorBindingRecord extends ProtectedBindingView {
  readonly referenceVerifier: string;
  readonly tupleKey: string;
  readonly scopeKey: string;
  readonly createdAt: number;
  status: 'active' | 'revoked';
  activeLeases: number;
  readonly leaseAbortControllers: Set<AbortController>;
}

export interface MintedConnectorBinding {
  readonly connectorContextRef: string;
  readonly expiresAt: number;
  readonly expiresIn: number;
  readonly bindingGeneration: number;
}

export interface ConnectorBindingLease {
  readonly value: ProtectedBindingView;
  readonly signal: AbortSignal;
  release(): void;
}
