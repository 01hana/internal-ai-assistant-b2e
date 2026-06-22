import { EvidenceConflictDetectorService } from '../../src/assistant/answer/evidence-conflict-detector.service';

describe('EvidenceConflictDetectorService', () => {
  it('detects conflicting normalized values for the same entity field', () => {
    const service = new EvidenceConflictDetectorService();

    const result = service.detect([
      {
        evidenceRefId: 'evidence-001',
        sourceType: 'structured_record',
        entityType: 'order',
        entityId: 'SO-10001',
        fieldPath: 'status',
        normalizedValue: 'confirmed'
      },
      {
        evidenceRefId: 'evidence-002',
        sourceType: 'structured_record',
        entityType: 'order',
        entityId: 'SO-10001',
        fieldPath: 'status',
        normalizedValue: 'cancelled'
      }
    ]);

    expect(result).toEqual({
      hasConflict: true,
      conflictReason: 'same_field_conflicting_values',
      conflictFieldPaths: ['status'],
      evidenceRefIds: ['evidence-001', 'evidence-002'],
      evidenceRefCount: 2
    });
  });

  it('does not treat identical normalized values as a conflict', () => {
    const service = new EvidenceConflictDetectorService();

    const result = service.detect([
      {
        evidenceRefId: 'evidence-001',
        sourceType: 'structured_record',
        entityType: 'order',
        entityId: 'SO-10001',
        fieldPath: 'status',
        normalizedValue: 'confirmed'
      },
      {
        evidenceRefId: 'evidence-002',
        sourceType: 'document_chunk',
        entityType: 'order',
        entityId: 'SO-10001',
        fieldPath: 'status',
        normalizedValue: 'confirmed'
      }
    ]);

    expect(result).toEqual({
      hasConflict: false,
      conflictReason: undefined,
      conflictFieldPaths: [],
      evidenceRefIds: [],
      evidenceRefCount: 0
    });
  });
});
