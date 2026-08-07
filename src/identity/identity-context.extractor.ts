import { Injectable } from '@nestjs/common';
import { Request } from 'express';
import { REQUEST_ID_PROPERTY } from '../common/request-id/request-id.constants';
import {
  IDENTITY_CONTEXT_REQUEST_PROPERTY,
  RequestIdentityContext,
  RequestWithIdentityContext
} from './identity-context.types';
import { validateRequestIdentityContext } from './identity-context.validator';

export const IDENTITY_HEADER_NAMES = {
  actorId: 'x-actor-id',
  hostApp: 'x-host-app',
  organizationId: 'x-organization-id',
  role: 'x-role',
  permissionScopes: 'x-permission-scopes'
} as const;

export type IdentityRequest = Request &
  RequestWithIdentityContext & {
    [REQUEST_ID_PROPERTY]?: string;
  };

@Injectable()
export class IdentityContextExtractor {
  extract(request: IdentityRequest): RequestIdentityContext {
    const identity = validateRequestIdentityContext({
      requestId: request[REQUEST_ID_PROPERTY],
      actorId: readHeader(request, IDENTITY_HEADER_NAMES.actorId),
      hostApp: readHeader(request, IDENTITY_HEADER_NAMES.hostApp),
      organizationId: readHeader(request, IDENTITY_HEADER_NAMES.organizationId),
      role: readHeader(request, IDENTITY_HEADER_NAMES.role),
      permissionScopes: parsePermissionScopes(readHeader(request, IDENTITY_HEADER_NAMES.permissionScopes))
    });

    request[IDENTITY_CONTEXT_REQUEST_PROPERTY] = identity;
    return identity;
  }
}

export function getIdentityContext(request: RequestWithIdentityContext): RequestIdentityContext | undefined {
  return request[IDENTITY_CONTEXT_REQUEST_PROPERTY];
}

function readHeader(request: Request, name: string): string | undefined {
  const value = request.header(name);
  return value && value.trim().length > 0 ? value : undefined;
}

export function parsePermissionScopes(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map((scope) => scope.trim())
    .filter(Boolean);
}
