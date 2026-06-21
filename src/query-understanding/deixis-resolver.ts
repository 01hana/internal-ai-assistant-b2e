import { Prisma } from '../generated/prisma/client';
import {
  QueryUnderstandingContextStateSnapshot,
  QueryUnderstandingResolvedReference
} from './query-understanding.types';

export const DEIXIS_PATTERN = /(這筆|這張|目前|剛剛選取|剛才選取)/;

export function resolveDeixisReferences(
  text: string,
  pageContext: Prisma.InputJsonValue | undefined,
  assistantContextState: QueryUnderstandingContextStateSnapshot | undefined
): QueryUnderstandingResolvedReference[] {
  if (!DEIXIS_PATTERN.test(text)) {
    return [];
  }

  const pageEntity = getPageEntity(pageContext);
  const selectedRows = getSelectedRows(pageContext);
  if (selectedRows.length > 1) {
    return selectedRows.map((row) => ({
      source: 'page_context',
      entityType: pageEntity?.entityType,
      entityId: row.id,
      confidence: 0.45,
      needsClarification: true,
      reason: 'multiple_candidates'
    }));
  }

  if (pageEntity?.entityType && pageEntity.entityId) {
    return [
      {
        source: 'page_context',
        entityType: pageEntity.entityType,
        entityId: pageEntity.entityId,
        confidence: 0.92,
        needsClarification: false,
        reason: 'page_context_entity'
      }
    ];
  }

  if (pageEntity?.entityType && !pageEntity.entityId) {
    return [
      {
        source: 'page_context',
        entityType: pageEntity.entityType,
        confidence: 0.3,
        needsClarification: true,
        reason: 'missing_entity_id'
      }
    ];
  }

  if (assistantContextState?.currentEntityType && assistantContextState.currentEntityId) {
    return [
      {
        source: 'context_state',
        entityType: assistantContextState.currentEntityType,
        entityId: assistantContextState.currentEntityId,
        confidence: 0.82,
        needsClarification: false,
        reason: 'context_state_entity'
      }
    ];
  }

  return [
    {
      source: 'page_context',
      confidence: 0.2,
      needsClarification: true,
      reason: 'missing_page_context'
    }
  ];
}

export function getPageEntity(pageContext: Prisma.InputJsonValue | undefined): { entityType?: string; entityId?: string } | undefined {
  const pageContextObject = toJsonRecord(pageContext);
  if (!pageContextObject) {
    return undefined;
  }

  return {
    entityType: typeof pageContextObject.entityType === 'string' ? pageContextObject.entityType : undefined,
    entityId: typeof pageContextObject.entityId === 'string' ? pageContextObject.entityId : undefined
  };
}

function getSelectedRows(pageContext: Prisma.InputJsonValue | undefined): Array<{ id?: string }> {
  const pageContextObject = toJsonRecord(pageContext);
  if (!pageContextObject || !Array.isArray(pageContextObject.selectedRows)) {
    return [];
  }

  return pageContextObject.selectedRows
    .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object' && !Array.isArray(row))
    .map((row: Record<string, unknown>) => ({
      id: typeof row.id === 'string' ? row.id : undefined
    }));
}

function toJsonRecord(value: Prisma.InputJsonValue | undefined): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}
