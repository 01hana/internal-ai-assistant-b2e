import { Injectable } from '@nestjs/common';
import { Request } from 'express';
import { REQUEST_ID_PROPERTY } from '../common/request-id/request-id.constants';
import {
  IDENTITY_CONTEXT_REQUEST_PROPERTY,
  RequestIdentityContext,
  RequestWithIdentityContext
} from './identity-context.types';

export type IdentityRequest = Request &
  RequestWithIdentityContext & {
    [REQUEST_ID_PROPERTY]?: string;
  };

@Injectable()
export class IdentityContextExtractor {
  attach(request: IdentityRequest, identity: RequestIdentityContext): RequestIdentityContext {
    request[IDENTITY_CONTEXT_REQUEST_PROPERTY] = identity;
    return identity;
  }
}

export function getIdentityContext(request: RequestWithIdentityContext): RequestIdentityContext | undefined {
  return request[IDENTITY_CONTEXT_REQUEST_PROPERTY];
}
