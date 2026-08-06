const describeUs3 = process.env.RUN_CUSTOMER_US3_TESTS === 'true' ? describe : describe.skip;

describeUs3('CustomerToolPolicyService public contract', () => {
  it.each([
    ['enabled', { customerId: 'customer-a', toolDefinitionId: 'tool-definition-orders-001', enabled: true, requiredRoles: [], requiredPermissionScopes: [] }, true],
    ['disabled', { customerId: 'customer-a', toolDefinitionId: 'tool-definition-orders-001', enabled: false, requiredRoles: [], requiredPermissionScopes: [] }, false],
    ['missing', null, false]
  ])('uses the public resolve API for %s policy', async (_scenario, policy, allowed) => {
    const CustomerToolPolicyService = await loadCustomerToolPolicyService();
    const findUnique = jest.fn().mockResolvedValue(policy);
    const service = new CustomerToolPolicyService({ db: { customerToolPolicy: { findUnique } } });
    const result = await service.resolve({ customerId: 'customer-a', toolDefinitionId: 'tool-definition-orders-001' });
    expect(findUnique).toHaveBeenCalledWith({ where: { customerId_toolDefinitionId: { customerId: 'customer-a', toolDefinitionId: 'tool-definition-orders-001' } } });
    expect(result.allowed).toBe(allowed);
  });
});

async function loadCustomerToolPolicyService(): Promise<new (prisma: { db: { customerToolPolicy: { findUnique: jest.Mock } } }) => { resolve(input: { customerId: string; toolDefinitionId: string }): Promise<{ allowed: boolean }> }> {
  const target = '../../src/tools/customer-tool-policy.service';
  try {
    const module = await import(target);
    if (typeof module.CustomerToolPolicyService !== 'function') throw new Error('T054 CustomerToolPolicyService public API is missing.');
    return module.CustomerToolPolicyService;
  } catch (error) {
    if (error instanceof Error && error.message.includes('Cannot find module')) throw new Error('T054 CustomerToolPolicyService is not implemented.');
    throw error;
  }
}
