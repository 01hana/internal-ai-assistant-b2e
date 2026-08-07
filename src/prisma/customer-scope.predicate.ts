import { CustomerScope } from '../identity/customer-scope.types';

type CustomerOverrideForbidden<T extends Record<string, unknown>> = T & { customerId?: never };
type CustomerScopedPredicate<T extends Record<string, unknown>> = Readonly<Omit<T, 'customerId'> & { customerId: string }>;

export function customerScopedIdPredicate<T extends { id: string }>(
  scope: CustomerScope,
  input: CustomerOverrideForbidden<T>
): CustomerScopedPredicate<T> {
  if (typeof input.id !== 'string' || input.id.trim().length === 0) {
    throw new Error('Customer-scoped ID predicate requires a non-blank id.');
  }
  return createCustomerScopedPredicate(scope, input);
}

export function customerScopedListPredicate<T extends Record<string, unknown> = Record<string, never>>(
  scope: CustomerScope,
  filters?: CustomerOverrideForbidden<T>
): CustomerScopedPredicate<T> {
  return createCustomerScopedPredicate(scope, filters ?? ({} as CustomerOverrideForbidden<T>));
}

export function customerScopedRelationPredicate<T extends Record<string, unknown>>(
  scope: CustomerScope,
  relation: CustomerOverrideForbidden<T>
): CustomerScopedPredicate<T> {
  assertNonEmptyConstraint(relation, 'relation');
  return createCustomerScopedPredicate(scope, relation);
}

export function customerScopedUniquePredicate<T extends Record<string, unknown>>(
  scope: CustomerScope,
  unique: CustomerOverrideForbidden<T>
): CustomerScopedPredicate<T> {
  assertNonEmptyConstraint(unique, 'unique key');
  return createCustomerScopedPredicate(scope, unique);
}

function createCustomerScopedPredicate<T extends Record<string, unknown>>(
  scope: CustomerScope,
  predicate: CustomerOverrideForbidden<T>
): CustomerScopedPredicate<T> {
  assertCustomerScope(scope);
  assertNoCustomerIdOverride(predicate);
  return Object.freeze({ ...predicate, customerId: scope.customerId }) as CustomerScopedPredicate<T>;
}

function assertCustomerScope(scope: CustomerScope): void {
  if (!scope || typeof scope.customerId !== 'string' || scope.customerId.trim().length === 0) {
    throw new Error('Customer scope is required.');
  }
}

function assertNoCustomerIdOverride(predicate: Record<string, unknown>): void {
  if (Object.prototype.hasOwnProperty.call(predicate, 'customerId')) {
    throw new Error('Customer-scoped predicates cannot override customerId.');
  }
}

function assertNonEmptyConstraint(predicate: Record<string, unknown>, kind: string): void {
  assertNoCustomerIdOverride(predicate);
  if (Object.keys(predicate).length === 0) {
    throw new Error(`Customer-scoped ${kind} predicate requires a constraint.`);
  }
}
