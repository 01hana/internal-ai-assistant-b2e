import {
  IDENTITY_CONTEXT_REQUEST_PROPERTY,
  RequestIdentityContext,
  RequestWithIdentityContext
} from './identity-context.types';

export function attachIdentityContext<T extends RequestWithIdentityContext>(
  request: T,
  identity: RequestIdentityContext
): RequestIdentityContext {
  request[IDENTITY_CONTEXT_REQUEST_PROPERTY] = identity;
  return identity;
}

export function getIdentityContext(request: RequestWithIdentityContext): RequestIdentityContext | undefined {
  return request[IDENTITY_CONTEXT_REQUEST_PROPERTY];
}
