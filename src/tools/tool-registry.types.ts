import { RiskLevel, ToolOperation } from '../generated/prisma/enums';
import type { ValidatedNamedOperation } from '../connectors/data-adapter.interface';

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
  timeoutMs: number;
  requiredPermissionScopes: string[];
  inputSchema: ToolJsonSchema;
  outputSchema: ToolJsonSchema;
  hasSideEffect: boolean;
  requiresConfirmation: boolean;
  requiresApproval: boolean;
}

export type ToolDiscoveryConceptGroup = 'resource' | 'intent' | 'metric' | 'timeRange';
export type ToolDiscoveryArgumentSource = 'entity_value' | 'normalized_term' | 'time_range_label';

export interface ToolDiscoveryArgumentBindingV1 {
  readonly argumentName: string;
  readonly source: ToolDiscoveryArgumentSource;
  readonly concepts: readonly string[];
}

export interface ToolDiscoveryMetadataV1 {
  readonly version: '1';
  readonly locale: 'zh-TW';
  readonly resourceConcepts: readonly string[];
  readonly intentConcepts: readonly string[];
  readonly metricConcepts: readonly string[];
  readonly timeRangeConcepts: readonly string[];
  readonly requiredConceptGroups: readonly ToolDiscoveryConceptGroup[];
  readonly argumentBindings: readonly ToolDiscoveryArgumentBindingV1[];
  readonly taskType: string;
  readonly requiredEvidence: readonly string[];
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

export interface SafeToolInputSummary {
  readonly canonicalToolKey: string;
  readonly schemaVersion: string;
  readonly argumentKeys: readonly string[];
  readonly argumentCount: number;
}

export type NamedOperationValidationResult =
  | {
      valid: true;
      operation: ValidatedNamedOperation;
      safeInputSummary: SafeToolInputSummary;
    }
  | {
      valid: false;
      deniedReason: 'schema_invalid';
      schemaErrorReason: string;
    };

export interface ToolResultPermissionMask {
  readonly fieldPath: string;
  readonly requiredPermissionScopes: readonly string[];
  readonly action: 'omit' | 'redact';
}

export interface ToolResultPolicyLimits {
  readonly maxDepth: number;
  readonly maxItems: number;
  readonly maxStringLength: number;
  readonly maxTotalBytes: number;
}

export interface ToolResultPolicyV1 {
  readonly version: '1';
  readonly allowedFieldPaths: readonly string[];
  readonly deniedFieldPaths: readonly string[];
  readonly permissionMasks: readonly ToolResultPermissionMask[];
  readonly limits: ToolResultPolicyLimits;
  readonly evidenceSafeProvenanceFields: readonly string[];
}

export type ToolResultPolicyResolution =
  | {
      readonly allowed: true;
      readonly policy: ToolResultPolicyV1;
    }
  | {
      readonly allowed: false;
      readonly reason: 'missing_result_policy' | 'invalid_result_policy' | 'unsupported_result_policy_version';
    };

export type SafeProjectedScalar = string | number | boolean | null;

export interface SafeProjectedAdapterResult {
  readonly kind: 'safe_projected_adapter_result';
  readonly canonicalToolKey: string;
  readonly schemaVersion: string;
  readonly facts: Readonly<Record<string, unknown>>;
  readonly fieldPaths: readonly string[];
  readonly evidenceProvenance: Readonly<Record<string, SafeProjectedScalar>>;
}

export type AdapterResultProjectionResult =
  | {
      readonly projected: true;
      readonly result: SafeProjectedAdapterResult;
    }
  | {
      readonly projected: false;
      readonly errorCode: 'ADAPTER_RESULT_PROJECTION_FAILED';
    };
