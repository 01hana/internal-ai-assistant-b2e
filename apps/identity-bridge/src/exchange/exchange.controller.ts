import { Body, Controller, Headers, HttpCode, Post } from '@nestjs/common';
import { ExchangeService, type ExchangeResult } from './exchange.service';
import {
  ExchangeCredentialError,
  ExchangeRequestError,
  normalizeExchangeRequestId,
  projectExchangeError
} from './redaction';

@Controller('identity')
export class ExchangeController {
  constructor(private readonly service: ExchangeService) {}

  @Post('exchange')
  @HttpCode(200)
  async exchange(
    @Headers('authorization') authorization: unknown,
    @Headers('x-request-id') requestIdHeader: unknown,
    @Body() body: unknown
  ): Promise<ExchangeResult> {
    const requestId = normalizeExchangeRequestId(requestIdHeader);
    try {
      assertEmptyBody(body);
      return await this.service.exchange(extractBearer(authorization));
    } catch (error) {
      throw projectExchangeError(error, requestId);
    }
  }
}

function extractBearer(value: unknown): string {
  if (value === undefined || value === null || typeof value === 'string' && !value.trim()) throw new ExchangeCredentialError();
  if (typeof value !== 'string') throw new ExchangeRequestError();
  const match = /^Bearer ([^\s]+)$/.exec(value);
  if (!match) throw new ExchangeRequestError();
  return match[1];
}

function assertEmptyBody(value: unknown): void {
  if (value === undefined) return;
  if (!plainRecord(value) || Reflect.ownKeys(value).length !== 0) throw new ExchangeRequestError();
}

function plainRecord(value: unknown): value is Record<PropertyKey, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
