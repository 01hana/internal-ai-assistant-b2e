import { Body, Controller, Headers, HttpCode, Post } from '@nestjs/common';
import { ManagedIdentityExchangeService } from './exchange.service';
import { projectManagedExchangeError } from './exchange-error.projector';
import { validateManagedExchangeRequest } from './exchange-request.validation';

@Controller('api/v1/identity')
export class ManagedIdentityExchangeController {
  constructor(private readonly service: ManagedIdentityExchangeService) {}

  @Post('exchange')
  @HttpCode(200)
  async exchange(
    @Headers('authorization') authorization: unknown,
    @Headers('x-request-id') requestId: unknown,
    @Headers('traceparent') _traceparent: unknown,
    @Body() body: unknown
  ): Promise<Readonly<{ accessToken: string; tokenType: string; expiresIn: number; requestId: string }>> {
    try {
      const input = validateManagedExchangeRequest({ authorization, requestId, body });
      const result = await this.service.exchange(input);
      return Object.freeze({
        accessToken: result.accessToken,
        tokenType: result.tokenType,
        expiresIn: result.expiresIn,
        requestId: input.requestId
      });
    } catch (error) {
      throw projectManagedExchangeError(error);
    }
  }
}
