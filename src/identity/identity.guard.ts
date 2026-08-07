import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { IdentityContextExtractor, IdentityRequest } from './identity-context.extractor';

@Injectable()
export class IdentityGuard implements CanActivate {
  constructor(private readonly extractor: IdentityContextExtractor) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<IdentityRequest>();
    this.extractor.extract(request);
    return true;
  }
}
