import type { CustomerScope } from '../identity/customer-scope.types';
import type { RequestIdentityContext } from '../identity/identity-context.types';

export const QUERY_SCOPE_REGISTRATIONS = 'QUERY_SCOPE_REGISTRATIONS';
export const QUERY_SCOPE_ACTIVATIONS = 'QUERY_SCOPE_ACTIVATIONS';

export type QueryScopeReason =
  | 'QUERY_SCOPE_OUTSIDE_AUTHORIZED_SCOPE'
  | 'QUERY_SCOPE_TARGET_UNVERIFIED'
  | 'QUERY_SCOPE_AMBIGUOUS'
  | 'QUERY_SCOPE_VALIDATED'
  | 'QUERY_SCOPE_POLICY_UNAVAILABLE';

export type QueryScopeDecision = Readonly<{
  outcome: 'ALLOW' | 'CLARIFY' | 'DENY' | 'NOT_APPLICABLE';
  reason?: QueryScopeReason;
}>;

export interface QueryScopePolicyInput {
  readonly query: string;
  readonly customerScope: CustomerScope;
  readonly identityContext: RequestIdentityContext;
  readonly capabilityKey: string;
  readonly bindingId: string;
  readonly toolKey: string;
  readonly toolVersion: string;
  /**
   * Set when the previous user turn of the same session was denied or sent back for
   * clarification by Query Scope. A policy may then refuse to let a target-less
   * follow-up silently fall back to the current company.
   */
  readonly previousTurnScopeOutcome?: 'DENY' | 'CLARIFY';
}

export interface QueryScopeActivation {
  readonly customerId: string;
  readonly integrationId: string;
  readonly hostApp: string;
  readonly capabilityKey: string;
  readonly bindingId: string;
  readonly toolKey: string;
  readonly toolVersion: string;
}

export interface QueryScopeRegistration extends QueryScopeActivation {
  /** A required registration without an available policy fails closed. */
  readonly policy?: { evaluate(input: QueryScopePolicyInput): QueryScopeDecision | Promise<QueryScopeDecision> };
}

export interface QueryScopeEvaluationInput {
  readonly customerScope: CustomerScope;
  readonly identityContext: RequestIdentityContext;
  readonly integrationId: string;
  readonly hostApp: string;
  readonly requestId: string;
  readonly sessionId: string;
  readonly sourceMessageId: string;
  readonly capabilityKey?: string;
  readonly bindingId?: string;
  readonly toolKey: string;
  readonly toolVersion: string;
  readonly query?: string;
}

/** Applicability evidence only; it carries no Tool arguments or execution authority. */
export interface PreCandidateQueryScopeApplicabilityV1 {
  readonly version: '1';
  readonly scope: Readonly<{ customerId: string; integrationId: string; hostApp: string }>;
  readonly packId: string;
  readonly packVersion: string;
  readonly capabilityKey: string;
  readonly bindingId: string;
  readonly bindingVersion: string;
  readonly toolKey: string;
  readonly toolVersion: string;
  readonly sourceMessageId: string;
  readonly evidenceSource: 'CURRENT_SCOPED_SEMANTIC';
}
