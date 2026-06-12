import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';
import { REQUEST_ID_HEADER, REQUEST_ID_PROPERTY } from './request-id.constants';

export type RequestWithRequestId = Request & {
  [REQUEST_ID_PROPERTY]?: string;
};

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: RequestWithRequestId, res: Response, next: NextFunction) {
    const headerValue = req.header(REQUEST_ID_HEADER);
    const requestId = headerValue && headerValue.trim().length > 0 ? headerValue : randomUUID();

    req[REQUEST_ID_PROPERTY] = requestId;
    res.setHeader(REQUEST_ID_HEADER, requestId);
    next();
  }
}
