import { Controller, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { CONNECTOR_INVOCATION_MAX_REQUEST_BYTES } from '@internal-ai-assistant/connector-runtime-contract';
import { ConnectorInvocationService } from './connector-invocation.service';
import { readBoundedInvocationBody } from './invocation-body.reader';
import { InvocationMonotonicClock } from './invocation-deadline';

@Controller()
export class ConnectorInvocationController {
  constructor(
    private readonly invocations: ConnectorInvocationService,
    private readonly clock: InvocationMonotonicClock = new InvocationMonotonicClock()
  ) {}
  @Post('v1/connector/invocations')
  async invoke(@Req() request: Request, @Res() response: Response): Promise<void> {
    const invocationStartedAt = this.clock.nowMilliseconds();
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
        return;
      }
      const result = await this.invocations.handle({ method: request.method, contentType: single(request.headers['content-type']),
        contentEncoding: single(request.headers['content-encoding']), authorization: single(request.headers.authorization),
        requestIdHeader: single(request.headers['x-request-id']), rawBody: read.value, requestSignal: abort.signal }, invocationStartedAt);
      response.status(result.statusCode).type('application/json').send(result.body);
    } finally {
      request.removeListener('aborted', onRequestAborted);
      response.removeListener('finish', onResponseFinished);
      response.removeListener('close', onResponseClosed);
    }
  }
}
function single(value: string | string[] | undefined): string | undefined { return typeof value === 'string' ? value : undefined; }
