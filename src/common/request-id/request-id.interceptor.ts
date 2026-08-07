import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { REQUEST_ID_PROPERTY } from './request-id.constants';
import { RequestWithRequestId } from './request-id.middleware';

@Injectable()
export class RequestIdInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const response = context.switchToHttp().getResponse();
    const request = context.switchToHttp().getRequest<RequestWithRequestId>();

    if (request[REQUEST_ID_PROPERTY]) {
      response.setHeader('x-request-id', request[REQUEST_ID_PROPERTY]);
    }

    return next.handle();
  }
}
