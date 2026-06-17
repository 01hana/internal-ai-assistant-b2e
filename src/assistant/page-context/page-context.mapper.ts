import { Prisma } from '../../generated/prisma/client';
import { PageContextDto } from './page-context.dto';
import { PageContextAuditMetadata, PageEntityRef } from './page-context.types';

export function toPageContextPersistence(pageContext?: PageContextDto): Prisma.InputJsonValue | undefined {
  if (!pageContext) {
    return undefined;
  }

  return {
    module: pageContext.module,
    route: pageContext.route,
    screenId: pageContext.screenId,
    entityType: pageContext.entityType,
    entityId: pageContext.entityId,
    selectedRows: pageContext.selectedRows ?? [],
    activeFilters: pageContext.activeFilters ?? [],
    visibleColumns: pageContext.visibleColumns ?? [],
    userVisibleState: pageContext.userVisibleState ?? {}
  } as unknown as Prisma.InputJsonValue;
}

export function getPageEntityRef(pageContext?: PageContextDto): PageEntityRef {
  return {
    entityType: pageContext?.entityType,
    entityId: pageContext?.entityId
  };
}

export function getVisibleColumns(pageContext?: PageContextDto): string[] {
  const visibleColumns = pageContext?.visibleColumns?.filter((column) => column.trim().length > 0) ?? [];
  return visibleColumns.length > 0 ? visibleColumns : ['status'];
}

export function toPageContextAuditMetadata(pageContext?: PageContextDto): PageContextAuditMetadata | undefined {
  if (!pageContext) {
    return undefined;
  }

  return {
    module: pageContext.module,
    screenId: pageContext.screenId,
    entityType: pageContext.entityType,
    entityId: pageContext.entityId,
    visibleColumnCount: pageContext.visibleColumns?.length ?? 0,
    selectedRowCount: pageContext.selectedRows?.length ?? 0,
    hasActiveFilters: (pageContext.activeFilters?.length ?? 0) > 0
  };
}
