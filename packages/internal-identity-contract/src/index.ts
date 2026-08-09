export const CANONICAL_INTERNAL_IDENTITY_CLAIM_NAMES = [
  'customer_id',
  'integration_id',
  'sub',
  'org_id',
  'host_app',
  'roles',
  'permission_scopes',
  'jti'
] as const;

export const REGISTERED_JWT_CLAIM_NAMES = ['iss', 'aud', 'iat', 'exp', 'nbf'] as const;

export const INTERNAL_IDENTITY_JWT_KEY_ID_HEADER = 'kid' as const;

export const INTERNAL_IDENTITY_JWT_ALGORITHM = 'RS256' as const;

export type CanonicalInternalIdentityClaimName = (typeof CANONICAL_INTERNAL_IDENTITY_CLAIM_NAMES)[number];
export type RegisteredJwtClaimName = (typeof REGISTERED_JWT_CLAIM_NAMES)[number];
export type InternalIdentityJwtKeyIdHeader = typeof INTERNAL_IDENTITY_JWT_KEY_ID_HEADER;
export type InternalIdentityJwtAlgorithm = typeof INTERNAL_IDENTITY_JWT_ALGORITHM;

export interface CanonicalInternalIdentityClaims {
  customer_id: string;
  integration_id: string;
  sub: string;
  org_id: string;
  host_app: string;
  roles: string[];
  permission_scopes: string[];
  jti: string;
}
