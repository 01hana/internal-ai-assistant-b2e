import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { map, Observable } from 'rxjs';
import { getRequestId } from '../request-id/request-id.util';
import { RequestWithRequestId } from '../request-id/request-id.middleware';

type Envelope<T> = {
  requestId: string;
  data: T;
};

@Injectable()
export class ResponseEnvelopeInterceptor<T> implements NestInterceptor<T, Envelope<T>> {
  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<Envelope<T>> {
    const request = context.switchToHttp().getRequest<RequestWithRequestId>();

    return next.handle().pipe(
      map((data) => ({
        requestId: getRequestId(request),
        data
      }))
    );
  }
}
