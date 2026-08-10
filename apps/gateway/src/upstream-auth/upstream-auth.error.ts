export type UpstreamAuthReasonCode =
  | 'missing_or_malformed_token'
  | 'invalid_algorithm'
  | 'invalid_kid'
  | 'invalid_signature'
  | 'issuer_mismatch'
  | 'audience_mismatch'
  | 'token_expired'
  | 'invalid_iat'
  | 'token_not_yet_valid'
  | 'invalid_claim_shape';

export class UpstreamAuthenticationError extends Error {
  readonly status = 401;
  readonly code = 'UPSTREAM_IDENTITY_INVALID';
  readonly #reasonCode: UpstreamAuthReasonCode;

  constructor(reasonCode: UpstreamAuthReasonCode) {
    super('Upstream identity is invalid.');
    this.#reasonCode = reasonCode;
  }

  /** Internal diagnostic only; prototype accessor keeps it out of JSON error surfaces. */
  get reasonCode(): UpstreamAuthReasonCode {
    return this.#reasonCode;
  }
}
