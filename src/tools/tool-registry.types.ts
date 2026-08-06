import { RiskLevel, ToolOperation } from '../generated/prisma/enums';

export type RegisteredToolOperation = ToolOperation;

export type ToolPermissionDeniedReason =
  | 'missing_scope'
  | 'operation_denied'
  | 'role_denied'
  | 'host_app_denied'
  | 'organization_boundary'
  | 'tool_not_registered'
  | 'tool_inactive'
  | 'customer_policy_denied'
  | 'schema_invalid'
  | 'tool_contract_mismatch'
  | 'idempotency_required';

export interface ToolJsonSchema {
  required: string[];
  [key: string]: unknown;
}

export interface RegisteredToolDefinition {
  id: string;
  key: string;
  name: string;
  version: string;
  description: string;
  operation: RegisteredToolOperation;
  riskLevel: RiskLevel;
  active: boolean;
  connectorKey: string;
  requiredPermissionScopes: string[];
  inputSchema: ToolJsonSchema;
  outputSchema: ToolJsonSchema;
  hasSideEffect: boolean;
  requiresConfirmation: boolean;
  requiresApproval: boolean;
}

export interface ToolRegistryResolveResult {
  tool?: RegisteredToolDefinition;
  deniedReason?: ToolPermissionDeniedReason;
}

export interface ResolvedCustomerTool {
  tool: RegisteredToolDefinition;
  requiredRoles: readonly string[];
  requiredPermissionScopes: readonly string[];
}

export interface CustomerToolRegistryResolveResult {
  resolved?: ResolvedCustomerTool;
  deniedReason?: ToolPermissionDeniedReason;
}

export type ToolValidationResult =
  | {
      valid: true;
    }
  | {
      valid: false;
      deniedReason: 'schema_invalid';
      schemaErrorReason: string;
    };
