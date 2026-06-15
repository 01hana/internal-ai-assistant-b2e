export type DependencyStatus = 'healthy' | 'degraded' | 'unavailable';
export type NoAnswerReason =
  | 'no_evidence'
  | 'low_confidence'
  | 'ambiguous_query'
  | 'permission_denied'
  | 'tool_failure'
  | 'evidence_conflict'
  | 'unsupported_scope'
  | 'missing_page_context';
export type PermissionDeniedReason = 'missing_scope' | 'organization_boundary' | 'host_app_boundary' | 'field_denied';
export type ToolFailureReason = 'timeout' | 'connector_unavailable' | 'validation_failed' | 'permission_denied' | 'unknown';
export type ApprovalDecisionStatus = 'pending' | 'approved' | 'rejected' | 'expired' | 'cancelled';
export type ConfirmationDecisionStatus = 'waiting_confirmation' | 'confirmed' | 'cancelled' | 'expired';

export interface DependencyStatusMetadata {
  dependency: string;
  status: DependencyStatus;
  checkedAt: string;
  reason?: string;
}

export interface RuntimeDecisionMetadata {
  durationMs?: number;
  dependencyStatus?: DependencyStatusMetadata;
  noAnswerReason?: NoAnswerReason;
  permissionDeniedReason?: PermissionDeniedReason;
  toolFailureReason?: ToolFailureReason;
  approvalDecisionStatus?: ApprovalDecisionStatus;
  confirmationDecisionStatus?: ConfirmationDecisionStatus;
}
