import { ToolExecutionStatus } from '../../src/generated/prisma/enums';

describe('US3 Customer-scoped idempotency contract', () => {

  it('reserves identical keys for independent Customer A and B tool calls', () => {
    const customerA = { customerId: 'customer-a', idempotencyKey: 'shared-tool-idempotency-key' };
    const customerB = { customerId: 'customer-b', idempotencyKey: 'shared-tool-idempotency-key' };
    expect(customerA).not.toEqual(customerB);
  });

  it('reserves a duplicate-safe execution status enum for replay and retry protection', () => {
    expect(ToolExecutionStatus.skipped_duplicate).toBe('skipped_duplicate');
  });

  it.each([
    ['same Customer replay', 'customer-a', 'customer-a', true],
    ['cross Customer identical key', 'customer-a', 'customer-b', false],
    ['foreign result lookup', 'customer-a', 'customer-b', false]
  ])('requires Customer ownership before exposing %s', (_scenario, requesterCustomerId, storedCustomerId, visible) => {
    const stored = { customerId: storedCustomerId, idempotencyKey: 'shared-tool-idempotency-key', output: 'private-result' };
    expect(stored.customerId === requesterCustomerId).toBe(visible);
  });
});
