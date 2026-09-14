import { generateKeyPairSync } from 'node:crypto';
import { bridgeEnvironment, fileReference, temporaryPemFile } from '../signing/signing-fixtures';

export function bindingEnvironment(options: Readonly<{
  connectorEnabled?: boolean;
  contextOverride?: Record<string, unknown>;
  override?: Record<string, unknown>;
}> = {}): Record<string, unknown> {
  const identity = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const identityJwk = identity.publicKey.export({ format: 'jwk' });
  const identityFile = temporaryPemFile(identity.privateKey.export({ type: 'pkcs8', format: 'pem' }), 'identity-phase8');
  const environment = bridgeEnvironment([{
    kid: 'identity-phase8', status: 'active',
    publicJwk: { ...identityJwk, kid: 'identity-phase8', alg: 'RS256', use: 'sig' },
    keyReference: fileReference(identityFile)
  }]);
  if (options.connectorEnabled === false) return { ...environment, ...options.override };
  const binding = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const bindingJwk = binding.publicKey.export({ format: 'jwk' });
  const bindingFile = temporaryPemFile(binding.privateKey.export({ type: 'pkcs8', format: 'pem' }), 'binding-phase8');
  return {
    ...environment,
    BRIDGE_CONNECTOR_BINDING_URI: 'https://connector-runtime.test/v1/internal/connector-bindings',
    BRIDGE_CONNECTOR_BINDING_DESTINATION_POLICY: JSON.stringify({ mode: 'public_only', allowedCidrs: [] }),
    BRIDGE_CONNECTOR_BINDING_CONTEXT_JSON: JSON.stringify({
      customerId: 'reference-customer', integrationId: 'configured-integration', hostApp: 'configured-host-app',
      connectorInstanceId: 'reference-connector-1', bootstrapProfileKey: 'BRIDGE_BINDING_TRANSPORT_V1',
      providerKey: 'shinmone-idx-bootstrap-v1', ...options.contextOverride
    }),
    BRIDGE_CONNECTOR_BINDING_SERVICE_AUTH_JSON: JSON.stringify({
      profileKey: 'BRIDGE_BINDING_TRANSPORT_V1', typ: 'assistant-connector-binding+jwt',
      issuer: 'urn:reference:bridge', subject: 'reference-bridge', audience: 'urn:connector-binding:reference',
      keyDomain: 'reference-bridge-binding-signing',
      keys: [{ kid: 'binding-phase8', status: 'active', publicJwk: { ...bindingJwk, kid: 'binding-phase8', alg: 'RS256', use: 'sig' }, privateKeyReference: fileReference(bindingFile) }]
    }),
    BRIDGE_BINDING_REQUEST_TIMEOUT_MS: '2000',
    ...options.override
  };
}
