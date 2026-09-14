import { AdapterResultProjectorService } from '../../src/connectors/adapter-result-projector.service';
import { RiskLevel, ToolOperation } from '../../src/generated/prisma/enums';
import { LlmInputSanitizerService } from '../../src/permissions/llm-input-sanitizer.service';
import {
  RegisteredToolDefinition,
  ToolResultPolicyResolution,
  ToolResultPolicyV1
} from '../../src/tools/tool-registry.types';

describe('AdapterResultProjectorService', () => {
  const service = new AdapterResultProjectorService(new LlmInputSanitizerService());

  it('rejects an undeclared productized local field before projection', () => {
    const result = service.project({
      tool: toolDefinition(),
      resultPolicy: allowedPolicy(),
      rawResult: { itemSku: 'SKU-001', availableQuantity: 4, rawCustomerPayload: 'SECRET' },
      permissionScopes: ['inventory:read']
    });

    expect(result).toEqual({ projected: false, errorCode: 'ADAPTER_RESULT_PROJECTION_FAILED' });
    expect(JSON.stringify(result)).not.toContain('SECRET');
  });

  it('validates the raw shape before projecting only server-allowed fields', () => {
    const result = service.project({
      tool: toolDefinition(),
      resultPolicy: allowedPolicy(),
      rawResult: {
        orderId: 'SO-10001',
        status: 'picking',
        organizationId: 'org-secret',
        details: {
          publicLabel: 'ready',
          internalCost: 9000
        }
      },
      permissionScopes: ['orders:read']
    });

    expect(result).toEqual({
      projected: true,
      result: {
        kind: 'safe_projected_adapter_result',
        canonicalToolKey: 'mock.orders.status.lookup',
        schemaVersion: '1.0.0',
        facts: {
          orderId: 'SO-10001',
          status: 'picking',
          details: { publicLabel: 'ready' }
        },
        fieldPaths: ['details.publicLabel', 'orderId', 'status'],
        evidenceProvenance: { orderId: 'SO-10001' }
      }
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(result.projected && Object.isFrozen(result.result.facts)).toBe(true);
    expect(JSON.stringify(result)).not.toContain('org-secret');
    expect(JSON.stringify(result)).not.toContain('9000');
  });

  it.each([
    { allowed: false, reason: 'missing_result_policy' } as const,
    { allowed: false, reason: 'invalid_result_policy' } as const,
    { allowed: false, reason: 'unsupported_result_policy_version' } as const
  ])('fails closed when result policy resolution is denied: $reason', (resultPolicy) => {
    expect(
      service.project({
        tool: toolDefinition(),
        resultPolicy,
        rawResult: { orderId: 'SO-10001', status: 'picking' },
        permissionScopes: ['orders:read']
      })
    ).toEqual({ projected: false, errorCode: 'ADAPTER_RESULT_PROJECTION_FAILED' });
  });

  it.each([
    ['missing required field', { orderId: 'SO-10001' }],
    ['wrong scalar type', { orderId: 'SO-10001', status: 12 }],
    ['undeclared field', { orderId: 'SO-10001', status: 'picking', password: 'raw-secret' }],
    ['malformed nested field', { orderId: 'SO-10001', status: 'picking', details: 'not-an-object' }]
  ])('releases nothing for malformed adapter data: %s', (_label, rawResult) => {
    const result = service.project({
      tool: toolDefinition(),
      resultPolicy: allowedPolicy(),
      rawResult,
      permissionScopes: ['orders:read']
    });

    expect(result).toEqual({ projected: false, errorCode: 'ADAPTER_RESULT_PROJECTION_FAILED' });
    expect(JSON.stringify(result)).not.toContain('raw-secret');
  });

  it('does not let Browser or adapter fields expand the policy', () => {
    const result = service.project({
      tool: toolDefinition(),
      resultPolicy: allowedPolicy(),
      rawResult: {
        orderId: 'SO-10001',
        status: 'picking',
        organizationId: 'org-secret',
        details: { publicLabel: 'ready', internalCost: 9000 }
      },
      permissionScopes: ['orders:read'],
      presentationFieldPaths: ['status', 'details.internalCost', 'organizationId']
    });

    expect(result.projected && result.result.facts).toEqual({ status: 'picking' });
    expect(JSON.stringify(result)).not.toContain('internalCost');
    expect(JSON.stringify(result)).not.toContain('organizationId');
  });

  it('projects before applying nested omit and redact masks for missing permissions', () => {
    const result = service.project({
      tool: toolDefinition(),
      resultPolicy: allowedPolicy({
        permissionMasks: [
          { fieldPath: 'details.publicLabel', requiredPermissionScopes: ['labels:read'], action: 'omit' },
          { fieldPath: 'details.internalCost', requiredPermissionScopes: ['costs:read'], action: 'redact' }
        ],
        allowedFieldPaths: ['orderId', 'status', 'details.publicLabel', 'details.internalCost'],
        deniedFieldPaths: ['organizationId']
      }),
      rawResult: {
        orderId: 'SO-10001',
        status: 'picking',
        details: { publicLabel: 'ready', internalCost: 9000 }
      },
      permissionScopes: ['orders:read']
    });

    expect(result.projected && result.result.facts).toEqual({
      orderId: 'SO-10001',
      status: 'picking',
      details: { internalCost: '[MASKED]' }
    });
    expect(JSON.stringify(result)).not.toContain('ready');
    expect(JSON.stringify(result)).not.toContain('9000');
  });

  it('retains masked fields when every required permission is trusted', () => {
    const result = service.project({
      tool: toolDefinition(),
      resultPolicy: allowedPolicy({
        permissionMasks: [
          { fieldPath: 'details.internalCost', requiredPermissionScopes: ['costs:read', 'finance:read'], action: 'redact' }
        ],
        allowedFieldPaths: ['orderId', 'details.internalCost'],
        deniedFieldPaths: ['organizationId']
      }),
      rawResult: {
        orderId: 'SO-10001',
        status: 'picking',
        details: { publicLabel: 'ready', internalCost: 9000 }
      },
      permissionScopes: ['orders:read', 'costs:read', 'finance:read']
    });

    expect(result.projected && result.result.facts).toEqual({ orderId: 'SO-10001', details: { internalCost: 9000 } });
  });

  it.each([
    ['max string length', { maxStringLength: 4 }, { orderId: 'SO-10001', status: 'picking' }],
    ['max item count', { maxItems: 2 }, { orderId: 'SO-10001', status: 'ok', tags: ['a', 'b', 'c'] }],
    ['max depth', { maxDepth: 2 }, { orderId: 'SO-10001', status: 'ok', details: { publicLabel: 'ready', internalCost: 1 } }],
    ['max total bytes', { maxTotalBytes: 16 }, { orderId: 'SO-10001', status: 'picking' }]
  ])('fails atomically when the projected result exceeds %s', (_label, limitOverride, rawResult) => {
    const result = service.project({
      tool: toolDefinition(),
      resultPolicy: allowedPolicy({
        allowedFieldPaths: ['orderId', 'status', 'tags', 'details.publicLabel'],
        limits: { ...allowedPolicyValue().limits, ...limitOverride }
      }),
      rawResult,
      permissionScopes: ['orders:read']
    });

    expect(result).toEqual({ projected: false, errorCode: 'ADAPTER_RESULT_PROJECTION_FAILED' });
    expect(JSON.stringify(result)).not.toContain('SO-10001');
  });

  it('fails atomically when downstream minimization throws', () => {
    const sanitizer = new LlmInputSanitizerService();
    jest.spyOn(sanitizer, 'sanitize').mockImplementation(() => {
      throw new Error('internal minimization details');
    });
    const throwingService = new AdapterResultProjectorService(sanitizer);

    expect(
      throwingService.project({
        tool: toolDefinition(),
        resultPolicy: allowedPolicy(),
        rawResult: { orderId: 'SO-10001', status: 'picking' },
        permissionScopes: ['orders:read']
      })
    ).toEqual({ projected: false, errorCode: 'ADAPTER_RESULT_PROJECTION_FAILED' });
  });

  describe('closed schema type unions', () => {
    const statusSchema = {
      type: ['string', 'array'],
      items: { type: 'string' },
      minItems: 1,
      maxItems: 100
    };

    it.each([
      ['string', 'picking'],
      ['string array', ['picking', 'packed']]
    ])('accepts a declared %s status', (_label, status) => {
      const result = service.project({
        tool: toolDefinition(statusSchema),
        resultPolicy: allowedPolicy(),
        rawResult: { orderId: 'SO-10001', status },
        permissionScopes: ['orders:read']
      });

      expect(result.projected && result.result.facts).toEqual({ orderId: 'SO-10001', status });
    });

    it.each([
      ['non-string array items', [1, 2]],
      ['object', {}],
      ['number', 42]
    ])('rejects an undeclared status variant: %s', (_label, status) => {
      expect(
        service.project({
          tool: toolDefinition(statusSchema),
          resultPolicy: allowedPolicy(),
          rawResult: { orderId: 'SO-10001', status },
          permissionScopes: ['orders:read']
        })
      ).toEqual({ projected: false, errorCode: 'ADAPTER_RESULT_PROJECTION_FAILED' });
    });
  });

  it('validates but never releases declared-and-denied customerCode', () => {
    const customerCode = 'CUSTOMER_SECRET_SENTINEL';
    const result = service.project({
      tool: toolDefinition(),
      resultPolicy: allowedPolicy({
        deniedFieldPaths: ['organizationId', 'customerCode']
      }),
      rawResult: { orderId: 'SO-10001', status: 'picking', customerCode },
      permissionScopes: ['orders:read'],
      presentationFieldPaths: ['status', 'customerCode']
    });

    expect(result.projected).toBe(true);
    expect(result.projected && result.result.facts).toEqual({ status: 'picking' });
    expect(JSON.stringify(result)).not.toContain(customerCode);
    expect(JSON.stringify(result)).not.toContain('customerCode');
  });
});

function toolDefinition(statusSchema: Record<string, unknown> = { type: 'string' }): RegisteredToolDefinition {
  return {
    id: 'tool-001',
    key: 'mock.orders.status.lookup',
    name: 'mock.orders.status.lookup',
    version: '1.0.0',
    description: 'Mock order status lookup',
    operation: ToolOperation.read,
    riskLevel: RiskLevel.low,
    active: true,
    connectorKey: 'mock',
    timeoutMs: 3000,
    requiredPermissionScopes: ['orders:read'],
    inputSchema: { required: ['entityId'] },
    outputSchema: {
      type: 'object',
      required: ['orderId', 'status'],
      properties: {
        orderId: { type: 'string' },
        customerCode: { type: 'string' },
        status: statusSchema,
        organizationId: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        details: {
          type: 'object',
          required: ['publicLabel', 'internalCost'],
          properties: {
            publicLabel: { type: 'string' },
            internalCost: { type: 'number' }
          }
        }
      }
    },
    hasSideEffect: false,
    requiresConfirmation: false,
    requiresApproval: false
  };
}

function allowedPolicy(overrides: Partial<ToolResultPolicyV1> = {}): ToolResultPolicyResolution {
  const policy: ToolResultPolicyV1 = {
    ...allowedPolicyValue(),
    ...overrides
  };
  return { allowed: true, policy };
}

function allowedPolicyValue(): ToolResultPolicyV1 {
  return {
    version: '1',
    allowedFieldPaths: ['orderId', 'status', 'details.publicLabel'],
    deniedFieldPaths: ['organizationId', 'details.internalCost'],
    permissionMasks: [],
    limits: {
      maxDepth: 4,
      maxItems: 100,
      maxStringLength: 512,
      maxTotalBytes: 16384
    },
    evidenceSafeProvenanceFields: ['orderId']
  };
}
