export type IdxTransportFailureCategory = 'unsafe_destination' | 'dns_failure' | 'timeout' | 'network_failure' | 'redirect_or_status' | 'content_type' | 'response_too_large' | 'malformed_json';

export class IdxTransportError extends Error {
  constructor(readonly category: IdxTransportFailureCategory) {
    super(`IDX transport failed: ${category}.`);
    this.name = 'IdxTransportError';
  }
}
