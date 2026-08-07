export type PermissionDecision = 'allow' | 'deny' | 'mask';
export type PermissionOperation = 'read' | 'create' | 'update' | 'delete' | 'export' | 'approve' | 'other';

export interface PermissionPolicyInput {
  actorId: string;
  organizationId: string;
  hostApp: string;
  permissionScopes: string[];
  module: string;
  operation: PermissionOperation;
  resourceType?: string;
  resourceId?: string;
  field?: string;
}

export interface PermissionPolicyResult {
  decision: PermissionDecision;
  reason?: string;
  deniedFields?: string[];
  allowedFields?: string[];
}

export interface PermissionPolicy {
  evaluate(input: PermissionPolicyInput): Promise<PermissionPolicyResult>;
}
