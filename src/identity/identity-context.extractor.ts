import { Request } from 'express';
import { REQUEST_ID_PROPERTY } from '../common/request-id/request-id.constants';
import { getIdentityContext } from './identity-context.accessor';
import { RequestWithIdentityContext } from './identity-context.types';

export type IdentityRequest = Request &
  RequestWithIdentityContext & {
    [REQUEST_ID_PROPERTY]?: string;
  };

// Compatibility export for callers; this module deliberately no longer reads identity headers.
export { getIdentityContext };
