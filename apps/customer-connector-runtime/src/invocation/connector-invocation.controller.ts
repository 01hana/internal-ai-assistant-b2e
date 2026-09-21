import { Controller, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { CONNECTOR_INVOCATION_MAX_REQUEST_BYTES } from '@internal-ai-assistant/connector-runtime-contract';
import { ConnectorInvocationService } from './connector-invocation.service';
import { readBoundedInvocationBody } from './invocation-body.reader';
import { InvocationMonotonicClock } from './invocation-deadline';
import { LocalConnectorDiagnostics } from '../diagnostics/local-connector-diagnostics';

@Controller()
export class ConnectorInvocationController {
  constructor(
    private readonly invocations: ConnectorInvocationService,
    private readonly clock: InvocationMonotonicClock = new InvocationMonotonicClock(),
    private readonly diagnostics: LocalConnectorDiagnostics = new LocalConnectorDiagnostics()
  ) {}
  @Post('v1/connector/invocations')
  async invoke(@Req() request: Request, @Res() response: Response): Promise<void> {
    const invocationStartedAt = this.clock.nowMilliseconds();
    const requestIdHeader = single(request.headers['x-request-id']);
    this.diagnostics.emit('INVOCATION_ROUTE_RECEIVED', 'RECEIVED', { requestId: requestIdHeader });
    const abort = new AbortController();
    let responseFinished = false;
    const onRequestAborted = () => abort.abort();
    const onResponseFinished = () => { responseFinished = true; };
    const onResponseClosed = () => {
      if (!responseFinished && !response.writableFinished) abort.abort();
    };
    request.once('aborted', onRequestAborted);
    response.once('finish', onResponseFinished);
    response.once('close', onResponseClosed);
    try {
      const read = await readBoundedInvocationBody(request, CONNECTOR_INVOCATION_MAX_REQUEST_BYTES, single(request.headers['content-length']));
      if (!read.ok) {
        response.setHeader('Connection', 'close');
        response.once('finish', () => request.socket?.destroy());
        response.status(400).type('application/json').send({
          version: '1', requestId: 'rejected-request', status: 'failed', error: { code: 'CONNECTOR_REQUEST_INVALID' }
        });
        this.diagnostics.emit('INVOCATION_RESPONSE_SENT', 'FAILED', {
          requestId: requestIdHeader,
          httpStatusCategory: 'HTTP_4XX',
          failureCategory: 'CONNECTOR_REQUEST_INVALID'
        });
        return;
      }
      const result = await this.invocations.handle({ method: request.method, contentType: single(request.headers['content-type']),
        contentEncoding: single(request.headers['content-encoding']), authorization: single(request.headers.authorization),
        requestIdHeader, rawBody: read.value, requestSignal: abort.signal }, invocationStartedAt);
      response.status(result.statusCode).type('application/json').send(result.body);
      this.diagnostics.emit('INVOCATION_RESPONSE_SENT', result.body.status === 'succeeded' ? 'SUCCEEDED' : 'FAILED', {
        requestId: result.body.requestId,
        httpStatusCategory: httpStatusCategory(result.statusCode),
        ...(result.body.status === 'failed' ? { failureCategory: result.body.error.code } : {})
      });
    } finally {
      request.removeListener('aborted', onRequestAborted);
      response.removeListener('finish', onResponseFinished);
      response.removeListener('close', onResponseClosed);
    }
  }
}
function single(value: string | string[] | undefined): string | undefined { return typeof value === 'string' ? value : undefined; }
function httpStatusCategory(status: number): string {
  if (status >= 200 && status < 300) return 'HTTP_2XX';
  if (status >= 400 && status < 500) return 'HTTP_4XX';
  if (status >= 500 && status < 600) return 'HTTP_5XX';
  return 'HTTP_OTHER';
}
