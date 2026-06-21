import { Prisma } from '../generated/prisma/client';
import { DEIXIS_PATTERN, getPageEntity } from './deixis-resolver';
import {
  QueryUnderstandingContextStateSnapshot,
  QueryUnderstandingEntityCandidate
} from './query-understanding.types';

const ORDER_PATTERN = /\bSO-\d{4,}\b/gi;
const WORK_ORDER_PATTERN = /\bWO-\d{4,}\b/gi;
const SKU_PATTERN = /\bSKU-[A-Z0-9-]+\b/gi;

export function extractEntityCandidates(
  text: string,
  pageContext: Prisma.InputJsonValue | undefined,
  assistantContextState: QueryUnderstandingContextStateSnapshot | undefined
): QueryUnderstandingEntityCandidate[] {
  const entities: QueryUnderstandingEntityCandidate[] = [];

  for (const value of text.match(ORDER_PATTERN) ?? []) {
    entities.push({ type: 'orderId', value: value.toUpperCase(), confidence: 0.95 });
  }
  for (const value of text.match(WORK_ORDER_PATTERN) ?? []) {
    entities.push({ type: 'workOrderId', value: value.toUpperCase(), confidence: 0.95 });
  }
  for (const value of text.match(SKU_PATTERN) ?? []) {
    entities.push({ type: 'itemSku', value: value.toUpperCase(), confidence: 0.92 });
  }

  const pageEntity = getPageEntity(pageContext);
  if (pageEntity?.entityType && pageEntity.entityId && DEIXIS_PATTERN.test(text)) {
    entities.push({
      type: toEntityType(pageEntity.entityType),
      value: pageEntity.entityId,
      confidence: 0.9
    });
  } else if (assistantContextState?.currentEntityType && assistantContextState.currentEntityId && DEIXIS_PATTERN.test(text)) {
    entities.push({
      type: toEntityType(assistantContextState.currentEntityType),
      value: assistantContextState.currentEntityId,
      confidence: 0.82
    });
  }

  return dedupeEntities(entities);
}

export function hasEntity(
  entities: QueryUnderstandingEntityCandidate[],
  type: QueryUnderstandingEntityCandidate['type']
): boolean {
  return entities.some((entity) => entity.type === type);
}

function toEntityType(entityType: string): QueryUnderstandingEntityCandidate['type'] {
  if (entityType === 'order') return 'orderId';
  if (entityType === 'workOrder') return 'workOrderId';
  if (entityType === 'itemSku' || entityType === 'inventory') return 'itemSku';
  if (entityType === 'customer') return 'customerId';
  if (entityType === 'supplier') return 'supplierId';
  return 'unknown';
}

function dedupeEntities(entities: QueryUnderstandingEntityCandidate[]): QueryUnderstandingEntityCandidate[] {
  const map = new Map<string, QueryUnderstandingEntityCandidate>();
  for (const entity of entities) {
    map.set(`${entity.type}:${entity.value}`, entity);
  }
  return [...map.values()];
}
