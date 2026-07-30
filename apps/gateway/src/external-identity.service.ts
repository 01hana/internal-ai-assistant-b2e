import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose';
import { GatewayConfigService } from './gateway-config.service';

export interface ExternalIdentity {
  actorId: string;
  organizationId: string;
  role: string;
  permissionScopes: string[];
  hostApp: string;
}

@Injectable()
export class ExternalIdentityService {
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;

  constructor(private readonly config: GatewayConfigService) {
    this.jwks = createRemoteJWKSet(new URL(config.externalJwksUri));
  }

  async verify(accessToken: string): Promise<ExternalIdentity> {
    try {
      const { payload } = await jwtVerify(accessToken, this.jwks, {
        issuer: this.config.externalJwtIssuer,
        audience: this.config.externalJwtAudience,
        algorithms: ['RS256']
      });
      return mapExternalClaims(payload, this.config);
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException({ error: 'EXTERNAL_ACCESS_TOKEN_INVALID', message: 'Missing or invalid access token.' });
    }
  }
}

function mapExternalClaims(payload: JWTPayload, config: GatewayConfigService): ExternalIdentity {
  const clientId = firstString(payload.azp, payload.client_id);
  const hostApp = clientId ? config.clientRegistry[clientId]?.hostApp : undefined;
  const scopes = toScopes(payload.permission_scopes, payload.scope);
  if (!isNonEmptyString(payload.sub) || !isNonEmptyString(payload.org_id) || !isNonEmptyString(payload.role) || !hostApp || scopes.length === 0) {
    throw new UnauthorizedException({ error: 'EXTERNAL_IDENTITY_CONTEXT_INVALID', message: 'Access token does not contain a permitted identity context.' });
  }

  return {
    actorId: payload.sub.trim(),
    organizationId: payload.org_id.trim(),
    role: payload.role.trim(),
    permissionScopes: scopes,
    hostApp
  };
}

function firstString(...values: unknown[]): string | undefined {
  return values.find(isNonEmptyString);
}

function toScopes(permissionScopes: unknown, scope: unknown): string[] {
  if (Array.isArray(permissionScopes) && permissionScopes.every(isNonEmptyString)) return permissionScopes.map((value) => value.trim());
  if (isNonEmptyString(scope)) return scope.split(' ').map((value) => value.trim()).filter(Boolean);
  return [];
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
