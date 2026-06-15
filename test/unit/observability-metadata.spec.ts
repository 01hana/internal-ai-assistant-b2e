import {
  createDependencyStatusMetadata,
  createDurationMetadata,
  createRuntimeDecisionMetadata,
  withApprovalDecisionStatus,
  withConfirmationDecisionStatus,
  withNoAnswerReason,
  withPermissionDeniedReason,
  withToolFailureReason
} from '../../src/observability/observability-metadata.helper';

describe('observability metadata helpers', () => {
  it('creates stable duration metadata', () => {
    expect(createDurationMetadata(new Date('2026-06-15T00:00:00.000Z'), new Date('2026-06-15T00:00:01.250Z'))).toEqual({
      durationMs: 1250
    });
  });

  it('creates dependency status metadata without leaking secret-looking values', () => {
    const metadata = createDependencyStatusMetadata(
      'openai',
      'degraded',
      'failed with sk-proj-secret-value-1234567890',
      new Date('2026-06-15T00:00:00.000Z')
    );

    expect(metadata).toMatchObject({
      dependency: 'openai',
      status: 'degraded',
      checkedAt: '2026-06-15T00:00:00.000Z'
    });
    expect(JSON.stringify(metadata)).not.toContain('sk-proj-secret-value');
  });

  it('creates analytics-ready decision reason metadata', () => {
    expect(
      createRuntimeDecisionMetadata({
        ...withNoAnswerReason('no_evidence'),
        ...withPermissionDeniedReason('missing_scope'),
        ...withToolFailureReason('timeout'),
        ...withApprovalDecisionStatus('pending'),
        ...withConfirmationDecisionStatus('waiting_confirmation')
      })
    ).toEqual({
      noAnswerReason: 'no_evidence',
      permissionDeniedReason: 'missing_scope',
      toolFailureReason: 'timeout',
      approvalDecisionStatus: 'pending',
      confirmationDecisionStatus: 'waiting_confirmation'
    });
  });
});
