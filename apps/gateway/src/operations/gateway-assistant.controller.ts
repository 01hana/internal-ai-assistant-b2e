import { BadRequestException, Body, Controller, Headers, HttpCode, HttpException, Param, Post, Res } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import { GatewayTrustChainHandler } from '../backend-client/gateway-trust-chain.handler';
import { IdentityResolutionError } from '../integration-registry/canonical-identity-resolver.service';
import { IdentityServiceUnavailableError } from '../signing/identity-service-unavailable.error';
import { UpstreamAuthenticationError } from '../upstream-auth/upstream-auth.error';

/**
 * The Gateway's single fixed Host operation. It has no routing or identity
 * authority: external Authorization is verifier-only and all Customer
 * authority remains inside the existing trust-chain handler.
 */
@Controller('api/v1/assistant')
export class GatewayAssistantController {
  constructor(private readonly trustChainHandler: GatewayTrustChainHandler) {}

  @Post('sessions')
  async createSession(
    @Headers('authorization') authorization: string | undefined,
    @Headers('x-request-id') requestIdHeader: string | undefined,
    @Headers('traceparent') traceparent: string | undefined,
    @Body() body: unknown
  ): Promise<unknown> {
    const pageContext = readCreateSessionPageContext(body);
    try {
      return await this.trustChainHandler.createSession({
        authorization,
        pageContext,
        requestId: normalizeRequestId(requestIdHeader),
        traceparent: optionalHeader(traceparent)
      });
    } catch (error) {
      throw projectTrustChainError(error);
    }
  }

  @Post('sessions/:id/messages')
  @HttpCode(200)
  async sendStreamMessage(
    @Headers('authorization') authorization: string | undefined,
    @Headers('x-request-id') requestIdHeader: string | undefined,
    @Headers('traceparent') traceparent: string | undefined,
    @Param('id') sessionId: string,
    @Body() body: unknown,
    @Res() response: Response
  ): Promise<void> {
    const input = readSendMessageInput(body);
    let stream: ReadableStream<Uint8Array>;
    const requestId = normalizeRequestId(requestIdHeader);
    try {
      stream = await this.trustChainHandler.sendStreamMessage({
        authorization,
        sessionId,
        message: input.message,
        pageContext: input.pageContext,
        requestId,
        traceparent: optionalHeader(traceparent)
      });
    } catch (error) {
      throw projectTrustChainError(error);
    }

    response.status(200);
    response.setHeader('content-type', 'text/event-stream; charset=utf-8');
    response.setHeader('cache-control', 'no-cache');
    const reader = stream.getReader();
    const cancel = () => { void reader.cancel(); };
    response.once('close', cancel);
    try {
      while (!response.writableEnded) {
        const next = await reader.read();
        if (next.done) break;
        response.write(Buffer.from(next.value));
      }
    } catch {
      if (!response.writableEnded) response.write(safeSseError(requestId));
    } finally {
      response.off('close', cancel);
      if (!response.writableEnded) response.end();
    }
  }
}

function readCreateSessionPageContext(body: unknown): Readonly<Record<string, unknown>> | undefined {
  if (!isRecord(body)) throw new BadRequestException('Invalid Gateway operation input.');
  const keys = Object.keys(body);
  if (keys.some((key) => key !== 'pageContext')) throw new BadRequestException('Invalid Gateway operation input.');
  if (body.pageContext === undefined) return undefined;
  if (!isRecord(body.pageContext)) throw new BadRequestException('Invalid Gateway operation input.');
  return body.pageContext;
}

function readSendMessageInput(body: unknown): Readonly<{ message: string; pageContext?: Readonly<Record<string, unknown>> }> {
  if (!isRecord(body)) throw new BadRequestException('Invalid Gateway operation input.');
  const keys = Object.keys(body);
  if (keys.some((key) => key !== 'message' && key !== 'pageContext') || !isNonBlankString(body.message)) {
    throw new BadRequestException('Invalid Gateway operation input.');
  }
  if (body.pageContext !== undefined && !isRecord(body.pageContext)) throw new BadRequestException('Invalid Gateway operation input.');
  return Object.freeze({ message: body.message, ...(body.pageContext === undefined ? {} : { pageContext: body.pageContext }) });
}

function normalizeRequestId(value: string | undefined): string {
  return typeof value === 'string' && value.trim().length > 0 ? value : randomUUID();
}

function optionalHeader(value: string | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function safeSseError(requestId: string): string {
  return `event: error\ndata: ${JSON.stringify({ requestId, code: 'BACKEND_UNAVAILABLE', message: 'Backend is unavailable.' })}\n\n`;
}

/** Fixed-operation HTTP projection; detailed verifier/resolver diagnostics stay internal. */
function projectTrustChainError(error: unknown): unknown {
  if (error instanceof UpstreamAuthenticationError) {
    return new HttpException({ statusCode: 401, code: 'UPSTREAM_IDENTITY_INVALID', message: 'Upstream identity is invalid.' }, 401);
  }
  if (error instanceof IdentityResolutionError) {
    return new HttpException({ statusCode: 403, code: 'IDENTITY_ISSUANCE_DENIED', message: 'Identity issuance cannot be completed.' }, 403);
  }
  if (error instanceof IdentityServiceUnavailableError) {
    return new HttpException({ statusCode: 503, code: 'IDENTITY_SERVICE_UNAVAILABLE', message: 'Identity service is unavailable.' }, 503);
  }
  if (typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'BACKEND_UNAVAILABLE') {
    return new HttpException({ statusCode: 503, code: 'BACKEND_UNAVAILABLE', message: 'Backend is unavailable.' }, 503);
  }
  return error;
}
