export const IDENTITY_CONTEXT_REQUEST_PROPERTY = 'identityContext';

export interface ActorContext {
  actorId: string;
  role: string;
  permissionScopes: string[];
}

export interface HostAppContext {
  hostApp: string;
}

export interface CompanyBoundary {
  organizationId: string;
}

export interface RequestIdentityContext {
  requestId: string;
  actor: ActorContext;
  hostApp: HostAppContext;
  company: CompanyBoundary;
}

export interface IdentityHeaders {
  actorId?: string;
  hostApp?: string;
  organizationId?: string;
  role?: string;
  permissionScopes?: string[];
  requestId?: string;
}

export interface BoundaryResource {
  organizationId: string;
  hostApp: string;
}

export type RequestWithIdentityContext = {
  [IDENTITY_CONTEXT_REQUEST_PROPERTY]?: RequestIdentityContext;
};
