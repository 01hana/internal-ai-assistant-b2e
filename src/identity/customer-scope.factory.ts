import { RequestIdentityContext } from './identity-context.types';
import { CustomerScope } from './customer-scope.types';

export function createCustomerScopeFromIdentityContext(identityContext: RequestIdentityContext): CustomerScope {
  return Object.freeze({
    customerId: identityContext.customer.customerId,
    integrationId: identityContext.customer.integrationId,
    organizationId: identityContext.organization.organizationId,
    hostApp: identityContext.hostApp.hostApp,
    actorId: identityContext.actor.actorId,
    roles: Object.freeze([...identityContext.actor.roles]),
    permissionScopes: Object.freeze([...identityContext.actor.permissionScopes])
  }) as CustomerScope;
}
