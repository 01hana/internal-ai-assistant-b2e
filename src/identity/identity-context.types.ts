export const IDENTITY_CONTEXT_REQUEST_PROPERTY = 'identityContext';

export interface CustomerContext {
  customerId: string;
  integrationId: string;
}

export interface OrganizationContext {
  organizationId: string;
}

export interface HostAppContext {
  hostApp: string;
}

export interface ActorContext {
  actorId: string;
  roles: string[];
  permissionScopes: string[];
}

export interface IdentityAuthContext {
  tokenId: string;
  gatewayIssuer: string;
}

export interface CanonicalIdentityContext {
  customer: CustomerContext;
  organization: OrganizationContext;
  hostApp: HostAppContext;
  actor: ActorContext;
  auth: IdentityAuthContext;
}

export interface RequestIdentityContext extends CanonicalIdentityContext {
  requestId: string;
}

export type RequestWithIdentityContext = {
  [IDENTITY_CONTEXT_REQUEST_PROPERTY]?: RequestIdentityContext;
};
