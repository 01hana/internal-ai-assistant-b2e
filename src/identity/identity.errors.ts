import { ForbiddenException, UnauthorizedException } from '@nestjs/common';

export const IDENTITY_CONTEXT_INVALID = 'IDENTITY_CONTEXT_INVALID';
export const IDENTITY_TOKEN_INVALID = 'IDENTITY_TOKEN_INVALID';

export class IdentityTokenException extends UnauthorizedException {
  constructor() {
    super({
      error: IDENTITY_TOKEN_INVALID,
      message: 'Missing or invalid identity token.'
    });
  }
}

export class IdentityContextException extends ForbiddenException {
  constructor(details: string[]) {
    super({
      error: IDENTITY_CONTEXT_INVALID,
      message: 'Missing or invalid identity context.',
      details: {
        fields: details
      }
    });
  }
}
