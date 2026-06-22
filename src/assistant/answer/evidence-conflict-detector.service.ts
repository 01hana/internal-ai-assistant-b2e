import { Injectable } from '@nestjs/common';

export interface NormalizedEvidenceFact {
  evidenceRefId: string;
  sourceType: 'structured_record' | 'document_chunk';
  entityType: string;
  entityId: string;
  fieldPath: string;
  normalizedValue: string;
}

export interface EvidenceConflictResult {
  hasConflict: boolean;
  conflictReason?: 'same_field_conflicting_values';
  conflictFieldPaths: string[];
  evidenceRefIds: string[];
  evidenceRefCount: number;
}

@Injectable()
export class EvidenceConflictDetectorService {
  detect(facts: NormalizedEvidenceFact[]): EvidenceConflictResult {
    const grouped = new Map<string, { values: Set<string>; evidenceRefIds: Set<string>; fieldPath: string }>();

    for (const fact of facts) {
      const key = `${fact.entityType}:${fact.entityId}:${fact.fieldPath}`;
      const existing = grouped.get(key) ?? {
        values: new Set<string>(),
        evidenceRefIds: new Set<string>(),
        fieldPath: fact.fieldPath
      };
      existing.values.add(fact.normalizedValue);
      existing.evidenceRefIds.add(fact.evidenceRefId);
      grouped.set(key, existing);
    }

    const conflicting = [...grouped.values()].filter((item) => item.values.size > 1);
    const evidenceRefIds = [...new Set(conflicting.flatMap((item) => [...item.evidenceRefIds]))];
    const conflictFieldPaths = [...new Set(conflicting.map((item) => item.fieldPath))];

    return {
      hasConflict: conflicting.length > 0,
      conflictReason: conflicting.length > 0 ? 'same_field_conflicting_values' : undefined,
      conflictFieldPaths,
      evidenceRefIds,
      evidenceRefCount: evidenceRefIds.length
    };
  }
}
