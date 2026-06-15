import {
  ActorContext,
  BoundaryResource,
  CompanyBoundary,
  HostAppContext,
  IdentityHeaders,
  RequestIdentityContext
} from './identity-context.types';
import { IdentityContextException } from './identity.errors';

export function validateActorContext(actor: Partial<ActorContext>): ActorContext {
  const missing = [
    isNonEmptyString(actor.actorId) ? undefined : 'actorId',
    isNonEmptyString(actor.role) ? undefined : 'role',
    Array.isArray(actor.permissionScopes) && actor.permissionScopes.length > 0 ? undefined : 'permissionScopes'
  ].filter((field): field is string => Boolean(field));

  if (missing.length > 0) {
    throw new IdentityContextException(missing);
  }

  const actorId = requireNonEmptyString(actor.actorId, 'actorId');
  const role = requireNonEmptyString(actor.role, 'role');
  const permissionScopes = requireNonEmptyArray(actor.permissionScopes, 'permissionScopes');

  return {
    actorId: actorId.trim(),
    role: role.trim(),
    permissionScopes: permissionScopes.map((scope) => scope.trim()).filter(Boolean)
  };
}

export function validateHostAppContext(hostApp: Partial<HostAppContext>): HostAppContext {
  if (!isNonEmptyString(hostApp.hostApp)) {
    throw new IdentityContextException(['hostApp']);
  }

  return {
    hostApp: hostApp.hostApp.trim()
  };
}

export function validateCompanyBoundary(company: Partial<CompanyBoundary>): CompanyBoundary {
  if (!isNonEmptyString(company.organizationId)) {
    throw new IdentityContextException(['organizationId']);
  }

  return {
    organizationId: company.organizationId.trim()
  };
}

export function validateRequestIdentityContext(headers: IdentityHeaders): RequestIdentityContext {
  const missing = [
    isNonEmptyString(headers.requestId) ? undefined : 'requestId',
    isNonEmptyString(headers.actorId) ? undefined : 'actorId',
    isNonEmptyString(headers.hostApp) ? undefined : 'hostApp',
    isNonEmptyString(headers.organizationId) ? undefined : 'organizationId',
    isNonEmptyString(headers.role) ? undefined : 'role',
    Array.isArray(headers.permissionScopes) && headers.permissionScopes.length > 0 ? undefined : 'permissionScopes'
  ].filter((field): field is string => Boolean(field));

  if (missing.length > 0) {
    throw new IdentityContextException(missing);
  }

  const requestId = requireNonEmptyString(headers.requestId, 'requestId');

  return {
    requestId: requestId.trim(),
    actor: validateActorContext({
      actorId: headers.actorId,
      role: headers.role,
      permissionScopes: headers.permissionScopes
    }),
    hostApp: validateHostAppContext({ hostApp: headers.hostApp }),
    company: validateCompanyBoundary({ organizationId: headers.organizationId })
  };
}

export function assertSameCompanyBoundary(identity: RequestIdentityContext, resource: BoundaryResource) {
  if (identity.company.organizationId !== resource.organizationId || identity.hostApp.hostApp !== resource.hostApp) {
    throw new IdentityContextException(['organizationId', 'hostApp']);
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (!isNonEmptyString(value)) {
    throw new IdentityContextException([field]);
  }

  return value;
}

function requireNonEmptyArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new IdentityContextException([field]);
  }

  return value;
}
