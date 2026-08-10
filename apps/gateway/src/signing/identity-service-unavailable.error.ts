/** Safe external projection for every Phase 5 signing or JWKS infrastructure failure. */
export class IdentityServiceUnavailableError extends Error {
  readonly status = 503;
  readonly code = 'IDENTITY_SERVICE_UNAVAILABLE';
  readonly auditReasonCode = 'signing_or_jwks_unavailable';

  constructor() {
    super('Identity service is unavailable.');
  }
}
