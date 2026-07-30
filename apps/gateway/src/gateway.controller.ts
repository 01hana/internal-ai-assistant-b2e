import { All, BadGatewayException, Controller, Get, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { Readable } from 'node:stream';
import { EXTERNAL_IDENTITY_PROPERTY, GatewayAccessTokenGuard } from './gateway-access-token.guard';
import { ExternalIdentity } from './external-identity.service';
import { GatewayConfigService } from './gateway-config.service';
import { InternalIdentityTokenService } from './internal-identity-token.service';

@Controller()
export class GatewayController {
  constructor(
    private readonly config: GatewayConfigService,
    private readonly internalIdentityTokens: InternalIdentityTokenService
  ) {}

  @Get('.well-known/jwks.json')
  getJwks() {
    return this.internalIdentityTokens.getJwks();
  }

  @All('api/v1/{*path}')
  @UseGuards(GatewayAccessTokenGuard)
  async proxy(@Req() request: Request & Record<string, unknown>, @Res() response: Response) {
    const identity = request[EXTERNAL_IDENTITY_PROPERTY] as ExternalIdentity;
    const internalToken = await this.internalIdentityTokens.sign(identity);
    const upstream = new URL(request.originalUrl, this.config.backendBaseUrl);
    const upstreamResponse = await fetch(upstream, {
      method: request.method,
      headers: this.forwardHeaders(request, internalToken),
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : JSON.stringify(request.body)
    }).catch(() => {
      throw new BadGatewayException({ error: 'BACKEND_UNAVAILABLE', message: 'Assistant backend is unavailable.' });
    });

    response.status(upstreamResponse.status);
    for (const header of ['content-type', 'cache-control']) {
      const value = upstreamResponse.headers.get(header);
      if (value) response.setHeader(header, value);
    }
    if (!upstreamResponse.body) return response.end();
    Readable.fromWeb(upstreamResponse.body as never).pipe(response);
  }

  private forwardHeaders(request: Request, internalToken: string): Record<string, string> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${internalToken}`,
      accept: request.header('accept') ?? 'application/json'
    };
    const contentType = request.header('content-type');
    if (contentType) headers['content-type'] = contentType;
    const requestId = request.header('x-request-id');
    if (requestId) headers['x-request-id'] = requestId;
    return headers;
  }
}
