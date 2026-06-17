export interface PageContextSelectedRow {
  id?: string;
  data?: Record<string, unknown>;
}

export interface PageEntityRef {
  entityType?: string;
  entityId?: string;
}

export interface PageContextAuditMetadata {
  module?: string;
  screenId?: string;
  entityType?: string;
  entityId?: string;
  visibleColumnCount: number;
  selectedRowCount: number;
  hasActiveFilters: boolean;
}
