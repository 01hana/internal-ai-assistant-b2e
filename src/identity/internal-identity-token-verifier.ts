import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose';
import { EnvironmentVariables } from '../common/config/env.validation';
import { IdentityContextException, IdentityTokenException } from './identity.errors';

export const INTERNAL_IDENTITY_TOKEN_VERIFIER = Symbol('INTERNAL_IDENTITY_TOKEN_VERIFIER');

export interface InternalIdentityClaims {
  subject: string;
  organizationId: string;
  role: string;
  permissionScopes: string[];
  hostApp: string;
  tokenId: string;
}

export interface InternalIdentityTokenVerifier {
  verify(token: string): Promise<InternalIdentityClaims>;
}

@Injectable()
export class JwksInternalIdentityTokenVerifier implements InternalIdentityTokenVerifier {
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;
  private readonly issuer: string;
  private readonly audience: string;
  private readonly clockTolerance: number;

  constructor(config: ConfigService<EnvironmentVariables>) {
    this.issuer = requireConfig(config, 'INTERNAL_IDENTITY_JWT_ISSUER');
    this.audience = requireConfig(config, 'INTERNAL_IDENTITY_JWT_AUDIENCE');
    this.clockTolerance = config.get<number>('INTERNAL_IDENTITY_JWT_CLOCK_TOLERANCE_SECONDS', 0);
    this.jwks = createRemoteJWKSet(new URL(requireConfig(config, 'INTERNAL_IDENTITY_JWKS_URI')));
  }

  async verify(token: string): Promise<InternalIdentityClaims> {
    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: this.issuer,
        audience: this.audience,
        algorithms: ['RS256'],
        clockTolerance: this.clockTolerance
      });

      return toInternalIdentityClaims(payload);
    } catch (error) {
      if (error instanceof IdentityTokenException || error instanceof IdentityContextException) {
        throw error;
      }
      throw new IdentityTokenException();
    }
  }
}

export function toInternalIdentityClaims(payload: JWTPayload): InternalIdentityClaims {
  const permissionScopes = payload.permission_scopes;
  if (
    !isNonEmptyString(payload.sub) ||
    !isNonEmptyString(payload.org_id) ||
    !isNonEmptyString(payload.role) ||
    !isNonEmptyString(payload.host_app) ||
    !isNonEmptyString(payload.jti) ||
    !isNumericDate(payload.iat) ||
    !isNumericDate(payload.exp) ||
    !Array.isArray(permissionScopes) ||
    permissionScopes.length === 0 ||
    !permissionScopes.every(isNonEmptyString)
  ) {
    throw new IdentityContextException(['sub', 'org_id', 'role', 'permission_scopes', 'host_app', 'jti', 'iat', 'exp']);
  }

  return {
    subject: payload.sub.trim(),
    organizationId: payload.org_id.trim(),
    role: payload.role.trim(),
    permissionScopes: permissionScopes.map((scope) => scope.trim()),
    hostApp: payload.host_app.trim(),
    tokenId: payload.jti.trim()
  };
}

function requireConfig(config: ConfigService<EnvironmentVariables>, key: keyof EnvironmentVariables): string {
  const value = config.get<string>(key);
  if (!value?.trim()) {
    throw new Error(`Missing required internal identity configuration: ${key}`);
  }
  return value.trim();
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isNumericDate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
