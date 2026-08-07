import { NotFoundException } from '@nestjs/common';
import { CustomerScope } from './customer-scope.types';
import { RequestIdentityContext } from './identity-context.types';

export function assertCustomerScopeMatchesIdentityContext(
  customerScope: CustomerScope,
  identityContext: RequestIdentityContext
): void {
  if (
    customerScope.customerId !== identityContext.customer.customerId ||
    customerScope.integrationId !== identityContext.customer.integrationId ||
    customerScope.organizationId !== identityContext.organization.organizationId ||
    customerScope.hostApp !== identityContext.hostApp.hostApp ||
    customerScope.actorId !== identityContext.actor.actorId ||
    !sameSet(customerScope.roles, identityContext.actor.roles) ||
    !sameSet(customerScope.permissionScopes, identityContext.actor.permissionScopes)
  ) {
    throw new NotFoundException({ error: 'NOT_FOUND', message: 'Customer resource not found.' });
  }
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  const normalizedLeft = [...new Set(left)].sort();
  const normalizedRight = [...new Set(right)].sort();
  return normalizedLeft.length === normalizedRight.length && normalizedLeft.every((value, index) => value === normalizedRight[index]);
}
