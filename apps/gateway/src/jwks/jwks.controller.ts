import { Controller, Get, Header, ServiceUnavailableException } from '@nestjs/common';
import { JwksService } from './jwks.service';

@Controller('.well-known')
export class JwksController {
  constructor(private readonly jwksService: JwksService) {}

  @Get('jwks.json')
  @Header('Cache-Control', 'public, max-age=60, must-revalidate')
  async getDocument() {
    try {
      return await this.jwksService.getDocument();
    } catch {
      throw new ServiceUnavailableException({
        statusCode: 503,
        code: 'IDENTITY_SERVICE_UNAVAILABLE',
        message: 'Identity service is unavailable.'
      });
    }
  }
}
