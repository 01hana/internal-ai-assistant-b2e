import { filterRow, maskFields, minimizeForLlmInput } from '../../src/permissions/masking.util';
import { PermissionOperation, PermissionPolicy, PermissionPolicyInput } from '../../src/permissions/permission-policy.interface';

describe('US2 permission filtering contracts', () => {
  const baseInput: PermissionPolicyInput = {
    actorId: 'actor-001',
    organizationId: 'org-001',
    hostApp: 'erp',
    permissionScopes: ['orders:read'],
    module: 'orders',
    operation: 'read'
  };

  it('fails closed when the module scope is missing', async () => {
    const policy = createPermissionPolicy();

    await expect(
      policy.evaluate({
        ...baseInput,
        module: 'inventory',
        permissionScopes: ['orders:read']
      })
    ).resolves.toEqual({
      decision: 'deny',
      reason: 'module_scope_missing'
    });
  });

  it('fails closed when the requested operation is not allowed by scope', async () => {
    const policy = createPermissionPolicy();

    await expect(
      policy.evaluate({
        ...baseInput,
        operation: 'update'
      })
    ).resolves.toEqual({
      decision: 'deny',
      reason: 'operation_scope_missing'
    });
  });

  it('drops denied rows before they can continue downstream', () => {
    const denied = filterRow(
      {
        orderId: 'SO-10001',
        status: 'picking'
      },
      false,
      'organization_boundary'
    );

    expect(denied).toEqual({
      allowed: false,
      reason: 'organization_boundary'
    });
  });

  it('keeps only authorized fields in LLM-bound payloads', () => {
    const record = {
      orderId: 'SO-10001',
      status: 'picking',
      customerName: '王小明企業',
      amount: 128000
    };

    expect(minimizeForLlmInput(record, ['status', 'customerName'])).toEqual({
      status: 'picking',
      customerName: '王小明企業'
    });
    expect(maskFields(record, { allowedFields: ['status', 'customerName'] })).toEqual({
      orderId: '[MASKED]',
      status: 'picking',
      customerName: '王小明企業',
      amount: '[MASKED]'
    });
  });
});

function createPermissionPolicy(): PermissionPolicy {
  return {
    async evaluate(input: PermissionPolicyInput) {
      if (!hasScope(input.permissionScopes, input.module, 'read')) {
        return {
          decision: 'deny',
          reason: 'module_scope_missing'
        };
      }

      if (!hasScope(input.permissionScopes, input.module, input.operation)) {
        return {
          decision: 'deny',
          reason: 'operation_scope_missing'
        };
      }

      return {
        decision: 'allow',
        allowedFields: ['status', 'customerName']
      };
    }
  };
}

function hasScope(scopes: string[], module: string, operation: PermissionOperation) {
  return scopes.includes(`${module}:${operation}`);
}
