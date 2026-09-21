import { Controller, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { CONNECTOR_BINDING_MAX_REQUEST_BYTES } from '@internal-ai-assistant/connector-runtime-contract';
import { ConnectorBindingRequestService } from './connector-binding-request.service';
import { LocalConnectorDiagnostics } from '../diagnostics/local-connector-diagnostics';

@Controller()
export class ConnectorBindingController {
  constructor(
    private readonly requests: ConnectorBindingRequestService,
    private readonly diagnostics: LocalConnectorDiagnostics
  ) {}

  @Post('v1/internal/connector-bindings')
  async create(@Req() request: Request, @Res() response: Response): Promise<void> {
    const startedAt = Date.now();
    const internalBindingRequestId = singleHeader(request.headers['x-request-id']);
    this.diagnostics.emit('BINDING_ROUTE_RECEIVED', 'RECEIVED', { internalBindingRequestId });
    const rawBody = await readBoundedBody(request, CONNECTOR_BINDING_MAX_REQUEST_BYTES + 1);
    const result = await this.requests.handle({
      method: request.method,
      contentType: singleHeader(request.headers['content-type']),
      contentEncoding: singleHeader(request.headers['content-encoding']),
      authorization: singleHeader(request.headers.authorization),
      rawBody,
      diagnosticRequestId: internalBindingRequestId
    });
    this.diagnostics.emit('BINDING_RESPONSE_SENT', 'SENT', {
      internalBindingRequestId,
      httpStatusCategory: httpStatusCategory(result.statusCode),
      durationMs: Date.now() - startedAt
    });
    response.status(result.statusCode).type('application/json').send(result.body);
  }
}

async function readBoundedBody(request: Request, retainMaximum: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let retained = 0;
  for await (const part of request) {
    const chunk = Buffer.isBuffer(part) ? part : Buffer.from(part as Uint8Array);
    if (retained < retainMaximum) {
      const kept = chunk.subarray(0, retainMaximum - retained);
      chunks.push(kept);
      retained += kept.byteLength;
    }
  }
  return Buffer.concat(chunks, retained);
}

function singleHeader(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function httpStatusCategory(status: number): string {
  return Number.isInteger(status) && status >= 100 && status <= 599 ? `HTTP_${Math.floor(status / 100)}XX` : 'HTTP_UNKNOWN';
}
