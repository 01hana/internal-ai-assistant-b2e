import { filterRow, maskFields, minimizeForLlmInput } from '../../src/permissions/masking.util';

describe('permission masking utilities', () => {
  const record = {
    orderId: 'SO-10001',
    status: 'picking',
    grossMargin: 0.32,
    internalNote: 'Manager-only note'
  };

  it('masks explicitly denied fields before LLM input', () => {
    expect(maskFields(record, { deniedFields: ['grossMargin', 'internalNote'] })).toEqual({
      orderId: 'SO-10001',
      status: 'picking',
      grossMargin: '[MASKED]',
      internalNote: '[MASKED]'
    });
  });

  it('keeps only allowed fields for partial authorization', () => {
    expect(maskFields(record, { allowedFields: ['orderId', 'status'] })).toEqual({
      orderId: 'SO-10001',
      status: 'picking',
      grossMargin: '[MASKED]',
      internalNote: '[MASKED]'
    });
    expect(minimizeForLlmInput(record, ['orderId', 'status'])).toEqual({
      orderId: 'SO-10001',
      status: 'picking'
    });
  });

  it('removes denied rows instead of passing them forward', () => {
    expect(filterRow(record, false, 'organization_boundary')).toEqual({
      allowed: false,
      reason: 'organization_boundary'
    });
    expect(filterRow(record, true)).toEqual({
      allowed: true,
      row: record
    });
  });
});
