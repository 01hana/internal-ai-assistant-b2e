import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BACKEND_COMPILED_ENTRYPOINT, LocalAssistantError, ROOT, assertSafeState, beginAppliedConfigReconciliation, beginNetworkReconciliation,
  bridgeBindingDeploymentMatches, bridgeBindingRouteMatches, connectorTlsAction, connectorTlsBindingsMatch,
  doctorFailureRootCause, doctorRootCauseFor, hostsBlockMatches, identityBridgeAction, idxVerifierRootCause,
  inspectDockerContainerEnvironment, inspectDockerPublishedBindings, missingPrerequisites, networkChanged, parseCloudflaredHostname, parseIpv4Routes,
  portDisposition, processAction, redact, renderHostsBlock, rollbackTargets, selectDockerSubnet, statusRecord,
  managedStopTargets, updateHostsContent,
  validateRootEnvironment
} from '../local-lib.mjs';

test('Backend launchers use the authoritative compiled entrypoint', () => {
  const packageJson = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const localStart = readFileSync(join(ROOT, 'dev/local-assistant/local-start.mjs'), 'utf8');
  assert.equal(BACKEND_COMPILED_ENTRYPOINT, 'dist/src/main.js');
  assert.equal(packageJson.scripts['start:prod'], 'node dist/src/main.js');
  assert.match(localStart, /args: \[BACKEND_COMPILED_ENTRYPOINT\]/);
  assert.match(localStart, /join\(ROOT, BACKEND_COMPILED_ENTRYPOINT\)/);
  assert.doesNotMatch(localStart, /args: \['dist\/main\.js'\]|join\(ROOT, 'dist\/main\.js'\)/);
  assert.equal(existsSync(join(ROOT, BACKEND_COMPILED_ENTRYPOINT)), true);
});

test('route/subnet collision detection selects a deterministic safe subnet', () => {
  const routes = parseIpv4Routes('172.30.70.0/24 link#1\n10.0.0.0/8 10.0.0.1');
  assert.equal(selectDockerSubnet(routes).subnet, '172.31.70.0/24');
  assert.throws(() => selectDockerSubnet(['172.0.0.0/8', '10.0.0.0/8']), (error) => error.rootCause === 'DOCKER_ROUTE_COLLISION');
});

test('LAN IP change is detected while unchanged network is reusable', () => {
  const before = { lanIp: '192.168.1.10', subnet: '172.30.70.0/24' };
  assert.equal(networkChanged(before, before), false);
  assert.equal(networkChanged(before, { ...before, lanIp: '192.168.2.10' }), true);
});

test('stale Connector TLS bindings force recreate even when state already contains the new LAN IP', () => {
  const inspection = publishedBindings('192.168.6.239');
  assert.equal(connectorTlsBindingsMatch(inspection, '192.168.0.250'), false);
  assert.equal(connectorTlsAction({
    exists: true, healthy: true, configChanged: false, networkChanged: false, bindingsMatch: false
  }), 'RECREATE');
});

test('matching Connector TLS 3443 and 3444 bindings can be reused', () => {
  const inspection = publishedBindings('192.168.0.250');
  assert.equal(connectorTlsBindingsMatch(inspection, '192.168.0.250'), true);
  assert.equal(connectorTlsAction({
    exists: true, healthy: true, configChanged: false, networkChanged: false, bindingsMatch: true
  }), 'REUSE');
});

test('Docker published binding inspection fails closed and is mockable', () => {
  const calls = [];
  const execute = (command, args) => {
    calls.push([command, args]);
    if (args.includes('ps')) return { status: 0, stdout: 'container-id\n' };
    return { status: 0, stdout: JSON.stringify({
      '3443/tcp': [{ HostIp: '192.168.0.250', HostPort: '3443' }],
      '3444/tcp': [{ HostIp: '192.168.0.250', HostPort: '3444' }]
    }) };
  };
  const result = inspectDockerPublishedBindings({ composeArgs: ['-f', 'fixture.yml'], service: 'connector-local-tls', execute });
  assert.equal(connectorTlsBindingsMatch(result, '192.168.0.250'), true);
  assert.equal(calls.length, 2);
  assert.equal(inspectDockerPublishedBindings({ composeArgs: [], service: 'connector-local-tls', execute: () => ({ status: 1, stdout: '' }) }).confirmed, false);
});

test('failed startup does not commit desired network and stale binding remains detectable next run', () => {
  const state = { network: { lanIp: '192.168.6.239', subnet: '172.30.70.0/24' } };
  const transaction = beginNetworkReconciliation(state.network, { lanIp: '192.168.0.250', subnet: '172.30.70.0/24' });
  assert.equal(transaction.changed, true);
  assert.equal(state.network.lanIp, '192.168.6.239');
  assert.equal(connectorTlsBindingsMatch(publishedBindings('192.168.6.239'), transaction.desired.lanIp), false);
  transaction.commit(state);
  assert.equal(state.network.lanIp, '192.168.0.250');
});

test('LAN change from office to home recreates the managed overlay', () => {
  const changed = networkChanged(
    { lanIp: '192.168.6.239', subnet: '172.30.70.0/24' },
    { lanIp: '192.168.0.250', subnet: '172.30.70.0/24' }
  );
  assert.equal(connectorTlsAction({
    exists: true, healthy: true, configChanged: false, networkChanged: changed,
    bindingsMatch: connectorTlsBindingsMatch(publishedBindings('192.168.6.239'), '192.168.0.250')
  }), 'RECREATE');
});

test('unknown container or process on an overlay port remains an unmanaged conflict', () => {
  assert.equal(connectorTlsAction({
    exists: false, healthy: false, configChanged: false, networkChanged: false, bindingsMatch: false
  }), 'START');
  assert.equal(portDisposition({ ownerPid: 200, managedPid: 100 }), 'CONFLICT');
});

test('stale Bridge allowlist forces recreate even when desired state hash is already current', () => {
  const desired = bridgeEnvironment('192.168.0.250');
  const actual = bridgeInspection('192.168.6.239');
  assert.equal(bridgeBindingDeploymentMatches(actual, desired), false);
  assert.equal(identityBridgeAction({
    exists: true, healthy: true, configChanged: false, networkChanged: false,
    deploymentMatches: bridgeBindingDeploymentMatches(actual, desired)
  }), 'RECREATE');
});

test('semantically matching Bridge URI and policy can be reused', () => {
  const desired = bridgeEnvironment('192.168.0.250');
  const actual = {
    confirmed: true,
    environment: {
      BRIDGE_CONNECTOR_BINDING_URI: desired.BRIDGE_CONNECTOR_BINDING_URI,
      BRIDGE_CONNECTOR_BINDING_DESTINATION_POLICY: '{ "allowedCidrs": ["192.168.0.250/32"], "mode": "allowlisted_networks" }'
    }
  };
  assert.equal(bridgeBindingDeploymentMatches(actual, desired), true);
  assert.equal(identityBridgeAction({ exists: true, healthy: true, configChanged: false, networkChanged: false, deploymentMatches: true }), 'REUSE');
});

test('Bridge container environment inspection is exact, selective, and fail closed', () => {
  const calls = [];
  const execute = (_command, args) => {
    calls.push(args);
    if (args.includes('ps')) return { status: 0, stdout: 'bridge-container\n' };
    return { status: 0, stdout: JSON.stringify([
      'UNRELATED_SECRET=must-not-return',
      'BRIDGE_CONNECTOR_BINDING_URI=https://connector-runtime.local.test:3443/v1/internal/connector-bindings',
      'BRIDGE_CONNECTOR_BINDING_DESTINATION_POLICY={"mode":"allowlisted_networks","allowedCidrs":["192.168.0.250/32"]}'
    ]) };
  };
  const result = inspectDockerContainerEnvironment({ composeArgs: ['-f', 'fixture.yml'], service: 'identity-bridge', execute });
  assert.equal(result.confirmed, true);
  assert.equal(Object.hasOwn(result.environment, 'UNRELATED_SECRET'), false);
  assert.equal(calls.length, 2);
  assert.equal(inspectDockerContainerEnvironment({ composeArgs: [], service: 'identity-bridge', execute: () => ({ status: 1, stdout: '' }) }).confirmed, false);
});

test('failed Bridge apply does not commit the desired hash into applied state', () => {
  const state = { containers: { identity: { managed: true, configHash: 'old' } } };
  const transaction = beginAppliedConfigReconciliation(state.containers.identity.configHash, 'new');
  assert.equal(transaction.changed, true);
  assert.equal(state.containers.identity.configHash, 'old');
  transaction.commit(state, 'identity', true);
  assert.equal(state.containers.identity.configHash, 'new');
});

test('Bridge route fails when DNS is current but the actual allowlist is stale', () => {
  assert.equal(bridgeBindingRouteMatches({
    actualInspection: bridgeInspection('192.168.6.239'), desiredEnvironment: bridgeEnvironment('192.168.0.250'),
    dnsInspection: { confirmed: true, addresses: ['192.168.0.250'] }, currentLanIp: '192.168.0.250'
  }), false);
});

test('Bridge route passes only when actual policy and every DNS address match the current LAN', () => {
  const desired = bridgeEnvironment('192.168.0.250');
  assert.equal(bridgeBindingRouteMatches({
    actualInspection: bridgeInspection('192.168.0.250'), desiredEnvironment: desired,
    dnsInspection: { confirmed: true, addresses: ['192.168.0.250'] }, currentLanIp: '192.168.0.250'
  }), true);
  assert.equal(bridgeBindingRouteMatches({
    actualInspection: bridgeInspection('192.168.0.250'), desiredEnvironment: desired,
    dnsInspection: { confirmed: true, addresses: ['192.168.0.250', '192.168.0.251'] }, currentLanIp: '192.168.0.250'
  }), false);
});

test('doctor distinguishes Connector Runtime from Connector TLS overlay failure', () => {
  const checks = Object.fromEntries([
    'OPENAI_CONFIG', 'POSTGRES', 'BACKEND', 'CONNECTOR_RUNTIME', 'CONNECTOR_TLS_OVERLAY', 'IDENTITY_BRIDGE',
    'IDX_PROXY', 'BRIDGE_CONNECTOR_BINDING_ROUTE', 'GATEWAY', 'JWKS_TRUST', 'LOCAL_HOST_MAPPING', 'LOCAL_DOCKER_NETWORK'
  ].map((name) => [name, 'PASS']));
  checks.CONNECTOR_TLS_OVERLAY = 'FAIL';
  assert.equal(doctorRootCauseFor(checks), 'CONNECTOR_TLS_OVERLAY_UNAVAILABLE');
});

test('doctor reports stale Bridge binding route and preserves IDX verifier stages', () => {
  const checks = Object.fromEntries([
    'OPENAI_CONFIG', 'POSTGRES', 'BACKEND', 'CONNECTOR_RUNTIME', 'CONNECTOR_TLS_OVERLAY', 'IDENTITY_BRIDGE',
    'IDX_PROXY', 'BRIDGE_CONNECTOR_BINDING_ROUTE', 'GATEWAY', 'JWKS_TRUST', 'LOCAL_HOST_MAPPING', 'LOCAL_DOCKER_NETWORK'
  ].map((name) => [name, 'PASS']));
  checks.BRIDGE_CONNECTOR_BINDING_ROUTE = 'FAIL';
  assert.equal(doctorRootCauseFor(checks), 'BRIDGE_CONNECTOR_BINDING_ROUTE_STALE');
  assert.equal(idxVerifierRootCause(20), 'IDX_TRANSPORT_UNAVAILABLE');
  assert.equal(idxVerifierRootCause(21), 'CONNECTOR_BINDING_UNAVAILABLE');
});

test('local start preserves a specific doctor root cause', () => {
  assert.equal(doctorFailureRootCause({ status: 1, stdout: 'LOCAL_ASSISTANT_READY=NO\nROOT_CAUSE=CONNECTOR_TLS_OVERLAY_UNAVAILABLE\n' }), 'CONNECTOR_TLS_OVERLAY_UNAVAILABLE');
  assert.equal(doctorFailureRootCause({ status: 1, stdout: 'unclassified failure' }), 'LOCAL_ENV_INVALID');
});

test('idempotent second start reuses a healthy matching managed process', () => {
  assert.equal(processAction({ metadata: { configHash: 'same' }, alive: true, healthy: true, configHash: 'same' }), 'REUSE');
});

test('unmanaged port ownership is a conflict and is never killed', () => {
  assert.equal(portDisposition({ ownerPid: 200, managedPid: 100 }), 'CONFLICT');
  assert.equal(portDisposition({ ownerPid: 100, managedPid: 100 }), 'MANAGED');
});

test('stale PID starts and unhealthy managed process restarts', () => {
  assert.equal(processAction({ metadata: { configHash: 'same' }, alive: false, healthy: false, configHash: 'same' }), 'START');
  assert.equal(processAction({ metadata: { configHash: 'same' }, alive: true, healthy: false, configHash: 'same' }), 'RESTART');
});

test('/etc/hosts marker rendering changes only the managed block', () => {
  const original = '127.0.0.1 localhost\n# custom entry\n10.0.0.8 custom.test\n';
  const once = updateHostsContent(original, '192.168.1.20');
  const twice = updateHostsContent(once, '192.168.1.21');
  assert.match(twice, /127\.0\.0\.1 localhost/);
  assert.match(twice, /10\.0\.0\.8 custom\.test/);
  assert.ok(hostsBlockMatches(twice, '192.168.1.21'));
  assert.equal((twice.match(/BEGIN internal-ai-assistant-local/g) ?? []).length, 1);
  assert.equal(renderHostsBlock('192.168.1.21').includes('127.0.0.1'), false);
});

test('missing prerequisites are reported exactly', () => {
  assert.deepEqual(missingPrerequisites({ available: ['node', 'npm', 'docker'], dockerDaemon: false, dockerCompose: true, needsMkcert: true }), ['mkcert', 'cloudflared', 'docker-daemon']);
});

test('missing or placeholder local env is rejected', () => {
  const result = validateRootEnvironment({
    DATABASE_URL: 'postgresql://x', POSTGRES_USER: 'x', POSTGRES_PASSWORD: 'x', POSTGRES_DB: 'x',
    LLM_MODEL: 'placeholder-model', OPENAI_API_KEY: '', GATEWAY_INTERNAL_JWT_ISSUER: 'http://127.0.0.1:4000',
    GATEWAY_INTERNAL_JWT_AUDIENCE: 'assistant', GATEWAY_ALLOWED_ORIGINS: 'http://localhost:3001'
  });
  assert.equal(result.valid, false);
  assert.deepEqual(result.missing, ['OPENAI_API_KEY']);
  assert.deepEqual(result.placeholders, ['LLM_MODEL']);
});

test('diagnostic output redacts bearer, API key, private key and JWT material', () => {
  const input = 'OPENAI_API_KEY=secret Bearer abc.def.ghi -----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----';
  const output = redact(input);
  assert.doesNotMatch(output, /secret|abc\.def\.ghi|BEGIN PRIVATE/);
});

test('state files prohibit secret-like fields', () => {
  assert.throws(() => assertSafeState({ services: {}, accessToken: 'nope' }), LocalAssistantError);
  assert.doesNotThrow(() => assertSafeState({ services: { backend: { pid: 1, port: 3000 } } }));
});

test('cloudflared hostname parsing accepts only quick-tunnel HTTPS hostnames', () => {
  assert.equal(parseCloudflaredHostname('INF + https://Calm-Tree-1.trycloudflare.com ready'), 'https://calm-tree-1.trycloudflare.com');
  assert.equal(parseCloudflaredHostname('https://evil.example.test'), undefined);
});

test('already-provisioned Gateway process is reused when healthy', () => {
  assert.equal(processAction({ metadata: { configHash: 'gateway-v1' }, alive: true, healthy: true, configHash: 'gateway-v1' }), 'REUSE');
});

test('partial startup rollback is reverse ordered and scoped', () => {
  assert.deepEqual(rollbackTargets([{ kind: 'container', name: 'postgres' }, { kind: 'unknown', name: 'spa' }, { kind: 'process', name: 'backend' }]), [
    { kind: 'process', name: 'backend' }, { kind: 'container', name: 'postgres' }
  ]);
});

test('status record is read-only data and local stop selects only managed resources', () => {
  assert.deepEqual(statusRecord({ running: true, healthy: false, id: 42, port: 3000 }), { running: 'running', health: 'unhealthy', id: 42, port: 3000 });
  assert.deepEqual(managedStopTargets({ services: { backend: { pid: 42 } }, containers: { postgres: { managed: true }, reused: { managed: false } } }), {
    processes: ['backend'], containers: ['postgres']
  });
});

function publishedBindings(ip, runtimePort = '3443', upstreamPort = '3444') {
  return {
    confirmed: true,
    bindings: {
      '3443/tcp': [{ hostIp: ip, hostPort: runtimePort }],
      '3444/tcp': [{ hostIp: ip, hostPort: upstreamPort }]
    }
  };
}

function bridgeEnvironment(ip) {
  return {
    BRIDGE_CONNECTOR_BINDING_URI: 'https://connector-runtime.local.test:3443/v1/internal/connector-bindings',
    BRIDGE_CONNECTOR_BINDING_DESTINATION_POLICY: JSON.stringify({ mode: 'allowlisted_networks', allowedCidrs: [`${ip}/32`] })
  };
}

function bridgeInspection(ip) {
  return { confirmed: true, environment: bridgeEnvironment(ip) };
}
