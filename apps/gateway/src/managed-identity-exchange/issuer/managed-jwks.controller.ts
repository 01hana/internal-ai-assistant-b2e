import { Controller, Get, Header, ServiceUnavailableException } from '@nestjs/common';
import { ManagedJwksService } from './managed-jwks.service';

@Controller('.well-known')
export class ManagedJwksController {
  constructor(private readonly jwks: ManagedJwksService) {}

  @Get('managed-identity-exchange-jwks.json')
  @Header('Cache-Control', 'public, max-age=60, must-revalidate')
  async getDocument() {
    try {
      return await this.jwks.getDocument();
    } catch {
      throw new ServiceUnavailableException({
        statusCode: 503,
        code: 'MANAGED_JWKS_UNAVAILABLE',
        message: 'Managed JWKS is unavailable.'
      });
    }
  }
}
