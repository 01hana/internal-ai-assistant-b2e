import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { JwksService } from './jwks.service';

@Controller('.well-known/jwks.json')
export class JwksController {
  constructor(private readonly jwks: JwksService) {}

  @Get()
  async getDocument() {
    try {
      return await this.jwks.document();
    } catch {
      throw new ServiceUnavailableException({ statusCode: 503, message: 'JWKS unavailable.' });
    }
  }
}
