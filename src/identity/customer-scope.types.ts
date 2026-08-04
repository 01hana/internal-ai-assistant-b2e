declare const CUSTOMER_SCOPE_BRAND: unique symbol;

export type CustomerScope = Readonly<{
  customerId: string;
  integrationId: string;
  organizationId: string;
  hostApp: string;
  actorId: string;
  roles: readonly string[];
  permissionScopes: readonly string[];
  readonly [CUSTOMER_SCOPE_BRAND]: true;
}>;
