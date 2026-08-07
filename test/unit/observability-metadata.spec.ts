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
import { createInternalIdentityJwtFixture } from '../support/internal-identity-jwt.helper';

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

  it('redacts Authorization and signed-token material from observability metadata', () => {
    const token = createInternalIdentityJwtFixture().sign();
    const metadata = createRuntimeDecisionMetadata({
      authorization: {
        bearer: `Bearer ${token}`,
        jwtSignature: token.split('.')[2],
        jwksPrivateMaterial: 'must-not-be-observable'
      }
    } as never);

    expect(JSON.stringify(metadata)).not.toContain(token);
    expect(JSON.stringify(metadata)).not.toContain(token.split('.')[2]);
    expect(JSON.stringify(metadata)).not.toContain('must-not-be-observable');
  });

  it('redacts nested claims, credentials, passwords, and raw exceptions while preserving safe trace fields', () => {
    const token = createInternalIdentityJwtFixture().sign();
    const metadata = createRuntimeDecisionMetadata({
      requestId: 'req-observability-safe',
      traceId: 'trace-observability-safe',
      nested: {
        authorization: `Bearer ${token}`,
        claims: { jti: 'jwt-customer-a', signature: token.split('.')[2] },
        jwks: { privateMaterial: 'jwks-private-material' },
        apiKey: 'api-key-material',
        credential: 'connector-credential',
        password: 'plain-password',
        rawException: 'raw exception secret=exception-secret'
      }
    } as never);

    const serialized = JSON.stringify(metadata);
    expect(serialized).toContain('req-observability-safe');
    expect(serialized).toContain('trace-observability-safe');
    [token, token.split('.')[2], 'jwks-private-material', 'api-key-material', 'connector-credential', 'plain-password', 'exception-secret'].forEach((secret) => {
      expect(serialized).not.toContain(secret);
    });
  });

  it('does not serialize Error message or stack into observability metadata', () => {
    const error = Object.assign(new Error('secret=observability-error-secret'), { code: 'OBSERVABILITY_FAILURE' });
    error.stack = 'Error: secret=observability-error-secret';
    const metadata = createRuntimeDecisionMetadata({ rawError: error, traceId: 'trace-error-safe' } as never);

    expect(metadata).toEqual(expect.objectContaining({
      traceId: 'trace-error-safe',
      rawError: expect.objectContaining({ code: 'OBSERVABILITY_FAILURE', message: '[REDACTED]', stack: '[REDACTED]' })
    }));
    expect(JSON.stringify(metadata)).not.toContain('observability-error-secret');
  });
});
