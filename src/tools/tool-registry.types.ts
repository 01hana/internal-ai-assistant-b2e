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
  | 'schema_invalid';

export interface ToolJsonSchema {
  required: string[];
  [key: string]: unknown;
}

export interface RegisteredToolDefinition {
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
}

export interface ToolRegistryResolveResult {
  tool?: RegisteredToolDefinition;
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
