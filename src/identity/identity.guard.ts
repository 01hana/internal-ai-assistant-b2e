import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { getRequestId } from '../common/request-id/request-id.util';
import { attachIdentityContext } from './identity-context.accessor';
import { IdentityRequest } from './identity-context.extractor';
import { validateVerifiedInternalIdentityClaims } from './identity-context.validator';
import { INTERNAL_IDENTITY_TOKEN_VERIFIER, InternalIdentityTokenVerifier } from './identity-token.types';

@Injectable()
export class IdentityGuard implements CanActivate {
  constructor(
    @Inject(INTERNAL_IDENTITY_TOKEN_VERIFIER)
    private readonly verifier: InternalIdentityTokenVerifier
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<IdentityRequest>();
    const verified = await this.verifier.verify({ authorization: request.header('authorization') });
    const canonical = validateVerifiedInternalIdentityClaims(verified);
    attachIdentityContext(request, {
      ...canonical,
      requestId: getRequestId(request)
    });
    return true;
  }
}
