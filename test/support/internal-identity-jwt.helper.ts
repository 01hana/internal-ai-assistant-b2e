import { createSign, generateKeyPairSync, KeyObject } from 'crypto';

export const TEST_GATEWAY_ISSUER = 'https://gateway.test.internal';
export const TEST_BACKEND_AUDIENCE = 'internal-assistant-core-test';
export const TEST_JWT_KID = 'gateway-test-rs256-2026';

export type CanonicalIdentityClaims = {
  customer_id: string;
  integration_id: string;
  sub: string;
  org_id: string;
  host_app: string;
  roles: string[];
  permission_scopes: string[];
  jti: string;
};

export type InternalTokenClaims = CanonicalIdentityClaims & {
  iss: string;
  aud: string;
  iat: number;
  exp: number;
  nbf?: number;
  [claim: string]: unknown;
};

export type TestJwtFixture = {
  kid: string;
  jwks: { keys: Array<Record<string, unknown>> };
  canonicalClaims: {
    customerA: CanonicalIdentityClaims;
    customerB: CanonicalIdentityClaims;
  };
  sign(input?: {
    claims?: Partial<InternalTokenClaims>;
    header?: Record<string, unknown>;
    algorithm?: 'RS256' | 'HS256' | 'none';
    privateKey?: KeyObject;
  }): string;
  tamper(token: string): string;
};

export function createInternalIdentityJwtFixture(
  now = Math.floor(Date.now() / 1_000),
): TestJwtFixture {
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const publicJwk = pair.publicKey.export({ format: 'jwk' }) as Record<string, unknown>;
  const customerA: CanonicalIdentityClaims = {
    customer_id: 'customer-a',
    integration_id: 'integration-erp',
    sub: 'actor-shared',
    org_id: 'org-shared',
    host_app: 'erp',
    roles: ['planner'],
    permission_scopes: ['orders:read'],
    jti: 'jwt-customer-a'
  };
  const customerB: CanonicalIdentityClaims = {
    ...customerA,
    customer_id: 'customer-b',
    jti: 'jwt-customer-b'
  };

  return {
    kid: TEST_JWT_KID,
    jwks: { keys: [{ ...publicJwk, kid: TEST_JWT_KID, use: 'sig', alg: 'RS256' }] },
    canonicalClaims: { customerA, customerB },
    sign(input = {}) {
      const algorithm = input.algorithm ?? 'RS256';
      const claims: InternalTokenClaims = {
        ...customerA,
        iss: TEST_GATEWAY_ISSUER,
        aud: TEST_BACKEND_AUDIENCE,
        iat: now,
        exp: now + 300,
        ...input.claims
      };
      const encodedHeader = encodeJson({ alg: algorithm, typ: 'JWT', kid: TEST_JWT_KID, ...input.header });
      const encodedClaims = encodeJson(claims);
      const signingInput = `${encodedHeader}.${encodedClaims}`;

      if (algorithm === 'none') return `${signingInput}.`;
      if (algorithm === 'HS256') return `${signingInput}.not-an-rs256-signature`;

      const signer = createSign('RSA-SHA256');
      signer.update(signingInput);
      signer.end();
      return `${signingInput}.${signer.sign(input.privateKey ?? pair.privateKey).toString('base64url')}`;
    },
    tamper(token) {
      const [header, payload, signature = ''] = token.split('.');
      const replacement = signature.startsWith('A') ? 'B' : 'A';
      return `${header}.${payload}.${replacement}${signature.slice(1)}`;
    }
  };
}

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}
