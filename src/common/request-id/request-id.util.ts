import { REQUEST_ID_PROPERTY } from './request-id.constants';
import { RequestWithRequestId } from './request-id.middleware';

export function getRequestId(request: RequestWithRequestId): string {
  return request[REQUEST_ID_PROPERTY] ?? 'unknown-request';
}
