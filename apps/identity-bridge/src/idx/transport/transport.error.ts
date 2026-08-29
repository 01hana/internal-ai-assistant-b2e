export type IdxTransportFailureCategory = 'credential_rejected' | 'identity_denied' | 'provider_unavailable';
type IdxTransportFailureReason = IdxTransportFailureCategory | 'unsafe_destination' | 'dns_failure' | 'timeout' | 'network_failure' | 'redirect_or_status' | 'content_type' | 'response_too_large' | 'malformed_json';

export class IdxTransportError extends Error {
  readonly category: IdxTransportFailureCategory;

  constructor(reason: IdxTransportFailureReason) {
    const category = reason === 'credential_rejected' || reason === 'identity_denied' ? reason : 'provider_unavailable';
    super(`IDX transport failed: ${category}.`);
    this.name = 'IdxTransportError';
    this.category = category;
  }
}
