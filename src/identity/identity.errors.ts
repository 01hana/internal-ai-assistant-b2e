import { BadRequestException } from '@nestjs/common';

export const IDENTITY_CONTEXT_INVALID = 'IDENTITY_CONTEXT_INVALID';

export class IdentityContextException extends BadRequestException {
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
