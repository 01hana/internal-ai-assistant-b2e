import { ConnectorDeploymentRegistry } from '../../src/connectors/productized-business/connector-deployment.registry';
import { parseProductizedAdapterBindings } from '../../src/connectors/productized-business/productized-adapter-binding.registry';
import {
  SHINMONE_REFERENCE_AUTHORITY,
  shinmoneAdapterBinding,
  shinmoneConnectorDeployment
} from '../support/shinmone-reference.fixture';

describe('Shinmone reference exact central deployment configuration', () => {
  it('resolves only the complete five-part active tuple and declares one exact operation version', () => {
    const registry = ConnectorDeploymentRegistry.fromJson(JSON.stringify([shinmoneConnectorDeployment()]));
    expect(registry.resolve(SHINMONE_REFERENCE_AUTHORITY)).toEqual({
      ok: true,
      value: expect.objectContaining({
        ...SHINMONE_REFERENCE_AUTHORITY,
        active: true,
        invocationUri: 'https://phase11-runtime.test:9443/v1/connector/invocations'
      })
    });
    expect(parseProductizedAdapterBindings(JSON.stringify([shinmoneAdapterBinding()]))).toEqual([
      expect.objectContaining({
        ...SHINMONE_REFERENCE_AUTHORITY,
        operations: [{ key: 'work-orders.monthly-new-count', version: '1.0.0' }]
      })
    ]);
  });

  it.each(['customerId', 'integrationId', 'hostApp', 'connectorKey', 'connectorInstanceId'] as const)(
    'rejects wrong %s without fallback',
    (field) => {
      const registry = ConnectorDeploymentRegistry.fromJson(JSON.stringify([shinmoneConnectorDeployment()]));
      expect(registry.resolve({ ...SHINMONE_REFERENCE_AUTHORITY, [field]: `wrong-${field}` })).toEqual({
        ok: false, code: 'CONNECTOR_UNAVAILABLE'
      });
    }
  );

  it('rejects inactive, wildcard, duplicate, and undeclared-operation reference configuration', () => {
    const inactive = ConnectorDeploymentRegistry.fromJson(JSON.stringify([shinmoneConnectorDeployment({ active: false })]));
    expect(inactive.resolve(SHINMONE_REFERENCE_AUTHORITY)).toEqual({ ok: false, code: 'CONNECTOR_UNAVAILABLE' });
    expect(() => ConnectorDeploymentRegistry.fromJson(JSON.stringify([shinmoneConnectorDeployment({ connectorInstanceId: '*' })]))).toThrow('CONNECTOR_CONFIGURATION_INVALID');
    expect(() => ConnectorDeploymentRegistry.fromJson(JSON.stringify([shinmoneConnectorDeployment(), shinmoneConnectorDeployment()]))).toThrow('CONNECTOR_CONFIGURATION_INVALID');
    expect(parseProductizedAdapterBindings(JSON.stringify([shinmoneAdapterBinding({
      operations: [{ key: 'work-orders.other', version: '1.0.0' }]
    })]))[0]?.operations).not.toContainEqual({ key: 'work-orders.monthly-new-count', version: '1.0.0' });
  });
});
