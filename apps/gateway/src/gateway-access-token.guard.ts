import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { ExternalIdentityService } from './external-identity.service';

export const EXTERNAL_IDENTITY_PROPERTY = 'gatewayExternalIdentity';

@Injectable()
export class GatewayAccessTokenGuard implements CanActivate {
  constructor(private readonly externalIdentityService: ExternalIdentityService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & Record<string, unknown>>();
    const token = readBearerToken(request);
    request[EXTERNAL_IDENTITY_PROPERTY] = await this.externalIdentityService.verify(token);
    return true;
  }
}

function readBearerToken(request: Request): string {
  const match = request.header('authorization')?.match(/^Bearer ([A-Za-z0-9._~-]+)$/);
  if (!match) throw new UnauthorizedException({ error: 'EXTERNAL_ACCESS_TOKEN_INVALID', message: 'Missing or invalid access token.' });
  return match[1];
}
