import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { REQUEST_ID_PROPERTY } from '../common/request-id/request-id.constants';
import { validateRequestIdentityContext } from './identity-context.validator';
import { IdentityContextExtractor, IdentityRequest } from './identity-context.extractor';
import { IdentityTokenException } from './identity.errors';
import { InternalIdentityTokenVerifier, INTERNAL_IDENTITY_TOKEN_VERIFIER } from './internal-identity-token-verifier';
import { Inject } from '@nestjs/common';

@Injectable()
export class IdentityGuard implements CanActivate {
  constructor(
    private readonly extractor: IdentityContextExtractor,
    @Inject(INTERNAL_IDENTITY_TOKEN_VERIFIER) private readonly tokenVerifier: InternalIdentityTokenVerifier
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<IdentityRequest>();
    const token = extractBearerToken(request);
    const claims = await this.tokenVerifier.verify(token);
    const identity = validateRequestIdentityContext({
      requestId: request[REQUEST_ID_PROPERTY],
      actorId: claims.subject,
      hostApp: claims.hostApp,
      organizationId: claims.organizationId,
      role: claims.role,
      permissionScopes: claims.permissionScopes
    });
    this.extractor.attach(request, identity);
    return true;
  }
}

export function extractBearerToken(request: IdentityRequest): string {
  const authorization = request.header('authorization');
  const match = authorization?.match(/^Bearer ([A-Za-z0-9._~-]+)$/);
  if (!match) {
    throw new IdentityTokenException();
  }
  return match[1];
}
