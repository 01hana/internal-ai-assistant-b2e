export type IdxTransportFailureCategory = 'credential_rejected' | 'identity_denied' | 'provider_unavailable';
export const IDX_TRANSPORT_FAILURE_REASONS = Object.freeze([
  'credential_rejected', 'identity_denied', 'provider_unavailable', 'unsafe_destination', 'dns_failure',
  'timeout', 'network_failure', 'redirect_or_status', 'content_type', 'response_too_large', 'malformed_json'
] as const);
export type IdxTransportFailureReason = typeof IDX_TRANSPORT_FAILURE_REASONS[number];

export class IdxTransportError extends Error {
  readonly category: IdxTransportFailureCategory;
  readonly reason: IdxTransportFailureReason;

  constructor(reason: IdxTransportFailureReason) {
    const category = reason === 'credential_rejected' || reason === 'identity_denied' ? reason : 'provider_unavailable';
    super(`IDX transport failed: ${category}.`);
    this.name = 'IdxTransportError';
    this.category = category;
    this.reason = reason;
  }
}
