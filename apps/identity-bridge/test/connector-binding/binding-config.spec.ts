import { BridgeConfigService } from '../../src/config/bridge-config.service';
import { bindingEnvironment } from './binding-fixtures';

describe('BRIDGE_BINDING_TRANSPORT_V1 configuration', () => {
  it('keeps the legacy Bridge connector-disabled when every binding setting is absent', () => {
    const config = new BridgeConfigService(bindingEnvironment({ connectorEnabled: false }));
    expect(config.isValid).toBe(true);
    expect(config.configuration.connectorBinding).toBeUndefined();
  });

  it('loads one deeply frozen exact binding destination, context, profile, and fixed timeout', () => {
    const config = new BridgeConfigService(bindingEnvironment());
    expect(config.isValid).toBe(true);
    expect(config.configuration.connectorBinding).toMatchObject({
      uri: 'https://connector-runtime.test/v1/internal/connector-bindings',
      timeoutMilliseconds: 2_000,
      context: {
        customerId: 'reference-customer', integrationId: 'configured-integration', hostApp: 'configured-host-app',
        connectorInstanceId: 'reference-connector-1',
        bootstrapProfileKey: 'BRIDGE_BINDING_TRANSPORT_V1', providerKey: 'shinmone-idx-bootstrap-v1'
      },
      serviceAuth: { profileKey: 'BRIDGE_BINDING_TRANSPORT_V1', typ: 'assistant-connector-binding+jwt' }
    });
    expect(Object.isFrozen(config.configuration.connectorBinding)).toBe(true);
    expect(Object.isFrozen(config.configuration.connectorBinding?.context)).toBe(true);
  });

  it('treats actor and organization as optional deployment narrowing constraints', () => {
    const baseOnly = new BridgeConfigService(bindingEnvironment());
    expect(baseOnly.isValid).toBe(true);
    expect(baseOnly.configuration.connectorBinding?.context).not.toHaveProperty('actorId');
    expect(baseOnly.configuration.connectorBinding?.context).not.toHaveProperty('organizationId');

    const narrowed = new BridgeConfigService(bindingEnvironment({ contextOverride: {
      actorId: 'user-a', organizationId: 'company-a'
    } }));
    expect(narrowed.isValid).toBe(true);
    expect(narrowed.configuration.connectorBinding?.context).toMatchObject({
      actorId: 'user-a', organizationId: 'company-a'
    });
  });

  it.each([
    { BRIDGE_CONNECTOR_BINDING_URI: 'http://connector-runtime.test/v1/internal/connector-bindings' },
    { BRIDGE_CONNECTOR_BINDING_URI: 'https://user@connector-runtime.test/v1/internal/connector-bindings' },
    { BRIDGE_CONNECTOR_BINDING_URI: 'https://connector-runtime.test/v1/internal/connector-bindings#fragment' },
    { BRIDGE_CONNECTOR_BINDING_URI: 'https://connector-runtime.test/v1/internal/connector-bindings?target=x' },
    { BRIDGE_CONNECTOR_BINDING_URI: 'https://*.test/v1/internal/connector-bindings' },
    { BRIDGE_CONNECTOR_BINDING_URI: 'https://connector-runtime.test/alternate' },
    { BRIDGE_BINDING_REQUEST_TIMEOUT_MS: '1999' },
    { BRIDGE_BINDING_REQUEST_TIMEOUT_MS: '2001' },
    { BRIDGE_CONNECTOR_BINDING_CONTEXT_JSON: JSON.stringify({ customerId: 'reference-customer' }) },
    { BRIDGE_CONNECTOR_BINDING_SERVICE_AUTH_JSON: JSON.stringify({}) },
    { BRIDGE_CONNECTOR_BINDING_DESTINATION_POLICY: JSON.stringify({ mode: 'public_only', allowedCidrs: ['10.0.0.0/8'] }) }
  ])('rejects malformed or authority-expanding connector configuration %#', (override) => {
    expect(new BridgeConfigService(bindingEnvironment({ override })).isValid).toBe(false);
  });

  it('rejects partial connector configuration and context conflicting with existing integration/HostApp', () => {
    const partial = bindingEnvironment({ connectorEnabled: false });
    partial.BRIDGE_CONNECTOR_BINDING_URI = 'https://connector-runtime.test/v1/internal/connector-bindings';
    expect(new BridgeConfigService(partial).isValid).toBe(false);

    const context = JSON.parse(String(bindingEnvironment().BRIDGE_CONNECTOR_BINDING_CONTEXT_JSON));
    context.hostApp = 'browser-choice';
    expect(new BridgeConfigService(bindingEnvironment({ override: {
      BRIDGE_CONNECTOR_BINDING_CONTEXT_JSON: JSON.stringify(context)
    } })).isValid).toBe(false);
  });
});
