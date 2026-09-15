export const SHINMONE_REFERENCE_AUTHORITY = Object.freeze({
  customerId: 'customer-a',
  integrationId: 'integration-erp',
  hostApp: 'erp',
  connectorKey: 'business',
  connectorInstanceId: 'shinmone-scm-connector-1'
});

export function shinmoneConnectorDeployment(overrides: Record<string, unknown> = {}) {
  return {
    version: '1',
    ...SHINMONE_REFERENCE_AUTHORITY,
    active: true,
    invocationUri: 'https://phase11-runtime.test:9443/v1/connector/invocations',
    serviceAuthProfileKey: 'central-shinmone-reference-v1',
    destinationPolicy: { mode: 'public_only', allowedCidrs: [] },
    maxRequestBytes: 16_384,
    maxResponseBytes: 16_384,
    maxTransportMs: 4_500,
    ...overrides
  };
}

export function shinmoneAdapterBinding(overrides: Record<string, unknown> = {}) {
  return {
    version: '1',
    active: true,
    ...SHINMONE_REFERENCE_AUTHORITY,
    operations: [{ key: 'work-orders.monthly-new-count', version: '1.0.0' }],
    ...overrides
  };
}
