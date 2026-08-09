/** Deterministic synthetic registry inputs; never retained-data inference. */
export const GATEWAY_INTEGRATION_BINDING_SEEDS = Object.freeze([
  Object.freeze({ customerId: 'customer-a', integrationId: 'integration-a', allowedHostApp: 'admin', enabled: true }),
  Object.freeze({ customerId: 'customer-b', integrationId: 'integration-b', allowedHostApp: 'admin', enabled: true })
]);
