#!/usr/bin/env node
'use strict';

const { randomUUID } = require('node:crypto');
const { isIP } = require('node:net');
const { resolve } = require('node:path');

const AUTHORITY = Object.freeze({
  customerId: 'customer-shinmone-scm-local',
  integrationId: 'shinmone-scm-assistant-local',
  hostApp: 'shinmone-scm',
  profileId: 'trust-shinmone-scm-assistant-local-v1',
  issuer: 'https://bridge-local.example.test',
  audience: 'internal-ai-assistant-local',
  algorithm: 'RS256'
});
const JWKS_PATH = '/.well-known/jwks.json';
const PRIVATE_JWK_FIELDS = Object.freeze(['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k']);

class LocalFeature007ProvisionError extends Error {
  constructor(code = 'local_feature007_provision_invalid') { super(code); this.name = 'LocalFeature007ProvisionError'; }
}

function parseArguments(args) {
  let jwksUri;
  let verifyOnly = false;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--jwks-uri' && jwksUri === undefined) jwksUri = args[++index];
    else if (args[index] === '--verify-only' && !verifyOnly) verifyOnly = true;
    else throw new LocalFeature007ProvisionError();
  }
  validateJwksUri(jwksUri);
  return Object.freeze({ jwksUri, verifyOnly });
}

async function executeLocalFeature007Provisioning(input) {
  try {
    (input.environmentValidator ?? validateLocalEnvironment)(input.environment);
    validateJwksUri(input.jwksUri);
    const dependencies = input.dependencies;
    const report = input.report ?? (() => undefined);
    try {
      dependencies.policy.validate(input.jwksUri);
      report('LOCAL_FEATURE004_JWKS_POLICY', 'PASS');
    } catch (error) {
      report('LOCAL_FEATURE004_JWKS_POLICY', 'FAIL');
      throw error;
    }
    try {
      validatePublicJwks(await dependencies.transport.fetch(input.jwksUri));
      report('LOCAL_FEATURE004_JWKS_RETRIEVAL', 'PASS');
    } catch (error) {
      report('LOCAL_FEATURE004_JWKS_RETRIEVAL', 'FAIL');
      throw error;
    }
    if (input.verifyOnly) return Object.freeze({ verified: true, mutated: false });

    const state = await preflight(dependencies, input.jwksUri);
    if (state.conflict) throw new LocalFeature007ProvisionError('local_feature007_provision_conflict');

    report('LOCAL_FEATURE004_DB_MUTATION_STARTED', 'YES');
    let mutated = false;
    if (!state.customer) {
      await dependencies.client.customer.create({ data: { id: AUTHORITY.customerId } });
      mutated = true;
    }
    const uuid = input.randomUUID ?? randomUUID;
    const binding = await dependencies.bindingCommand.execute({
      customerId: AUTHORITY.customerId,
      integrationId: AUTHORITY.integrationId,
      allowedHostApp: AUTHORITY.hostApp,
      enabled: true,
      requestId: uuid()
    });
    const profile = await dependencies.profileCommand.execute({
      action: 'create',
      id: AUTHORITY.profileId,
      integrationId: AUTHORITY.integrationId,
      expectedIssuer: AUTHORITY.issuer,
      expectedAudience: AUTHORITY.audience,
      jwksUri: input.jwksUri,
      algorithm: AUTHORITY.algorithm,
      enabled: true,
      lifecycle: 'active',
      version: 1,
      replacesProfileId: null,
      requestId: uuid()
    });
    await dependencies.readiness.assertReady();
    mutated = mutated || binding.changed === true || profile.changed === true;
    return Object.freeze({ verified: true, mutated, customerState: 'READY', bindingState: 'READY', profileState: 'READY' });
  } catch (error) {
    if (error instanceof LocalFeature007ProvisionError) throw error;
    throw new LocalFeature007ProvisionError();
  }
}

async function preflight(dependencies, jwksUri) {
  const [customer, binding, profiles, profileById] = await Promise.all([
    dependencies.client.customer.findUnique({ where: { id: AUTHORITY.customerId } }),
    dependencies.bindingRepository.findByIntegrationId(AUTHORITY.integrationId),
    dependencies.profileRepository.findByIntegrationId(AUTHORITY.integrationId),
    typeof dependencies.profileRepository.findById === 'function' ? dependencies.profileRepository.findById(AUTHORITY.profileId) : Promise.resolve(null)
  ]);
  const bindingConflict = Boolean(binding && (binding.customerId !== AUTHORITY.customerId || binding.allowedHostApp !== AUTHORITY.hostApp));
  const profileRecords = [...profiles];
  if (profileById && !profileRecords.some((record) => record.id === profileById.id)) profileRecords.push(profileById);
  const profileConflict = profileRecords.length > 1 || profileRecords.some((record) => !sameProfile(record, jwksUri));
  return { customer, binding, conflict: bindingConflict || profileConflict };
}

function sameProfile(record, jwksUri) {
  return record.id === AUTHORITY.profileId
    && record.integrationId === AUTHORITY.integrationId
    && record.expectedIssuer === AUTHORITY.issuer
    && record.expectedAudience === AUTHORITY.audience
    && record.algorithm === AUTHORITY.algorithm
    && record.enabled === true
    && record.lifecycle === 'active'
    && record.version === 1
    && (record.replacesProfileId === null || record.replacesProfileId === undefined)
    && record.jwksUri === jwksUri;
}

function validateLocalEnvironment(environment) {
  if (!environment || environment.NODE_ENV !== 'development') throw new LocalFeature007ProvisionError();
  let database;
  try { database = new URL(environment.DATABASE_URL); } catch { throw new LocalFeature007ProvisionError(); }
  const hostname = database.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!['postgresql:', 'postgres:'].includes(database.protocol)
    || !['localhost', '127.0.0.1', '::1'].includes(hostname)
    || database.pathname !== '/assistant_dev') throw new LocalFeature007ProvisionError();
}

function validateJwksUri(value) {
  let url;
  try { url = new URL(value); } catch { throw new LocalFeature007ProvisionError(); }
  const hostname = url.hostname.toLowerCase().replace(/\.+$/, '').replace(/^\[|\]$/g, '');
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== JWKS_PATH || url.search || url.hash
    || !hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || isIP(hostname)) throw new LocalFeature007ProvisionError();
}

function validatePublicJwks(document) {
  if (!document || typeof document !== 'object' || !Array.isArray(document.keys) || document.keys.length === 0) throw new LocalFeature007ProvisionError();
  for (const key of document.keys) {
    if (!key || typeof key !== 'object' || Array.isArray(key)
      || key.kty !== 'RSA' || key.alg !== 'RS256' || key.use !== 'sig'
      || !nonBlank(key.kid) || !nonBlank(key.n) || !nonBlank(key.e)
      || PRIVATE_JWK_FIELDS.some((field) => Object.prototype.hasOwnProperty.call(key, field))) throw new LocalFeature007ProvisionError();
  }
}

function nonBlank(value) { return typeof value === 'string' && value.trim().length > 0; }

function createRuntimeDependencies(databaseUrl) {
  const dist = resolve(__dirname, '../dist');
  const { GatewayIdentityAuditWriter } = require(resolve(dist, 'audit/gateway-identity-audit.writer.js'));
  const { ProvisionIntegrationBindingCommand, ProvisionIntegrationBindingService } = require(resolve(dist, 'commands/provision-integration-binding.js'));
  const { ProvisionTrustProfileCommand } = require(resolve(dist, 'commands/provision-trust-profile.js'));
  const { createGatewayPrismaClient } = require(resolve(dist, 'integration-registry/gateway-prisma-client.factory.js'));
  const { IntegrationBindingRepository } = require(resolve(dist, 'integration-registry/integration-binding.repository.js'));
  const { TrustProfileActivationValidator, ProductionJwksSourceRegistrationPolicy } = require(resolve(dist, 'integration-registry/trust-profile-activation.validator.js'));
  const { TrustProfileRepository } = require(resolve(dist, 'integration-registry/trust-profile.repository.js'));
  const { TrustProfileRuntimeReadiness } = require(resolve(dist, 'integration-registry/trust-profile-runtime-readiness.service.js'));
  const { HardenedJwksTransport } = require(resolve(dist, 'upstream-auth/jwks-transport.adapter.js'));
  const client = createGatewayPrismaClient(databaseUrl);
  const bindingRepository = new IntegrationBindingRepository(client);
  const profileRepository = new TrustProfileRepository(client);
  const policy = new ProductionJwksSourceRegistrationPolicy();
  return {
    client,
    bindingRepository,
    profileRepository,
    bindingCommand: new ProvisionIntegrationBindingCommand(new ProvisionIntegrationBindingService(bindingRepository)),
    profileCommand: new ProvisionTrustProfileCommand({
      repository: profileRepository,
      validator: new TrustProfileActivationValidator({ repository: profileRepository, jwksSourcePolicy: policy }),
      auditWriter: new GatewayIdentityAuditWriter(client),
      invalidation: { invalidate: async () => undefined }
    }),
    readiness: new TrustProfileRuntimeReadiness(profileRepository),
    policy,
    transport: new HardenedJwksTransport()
  };
}

async function main() {
  let dependencies;
  const diagnostics = new Map([
    ['LOCAL_FEATURE004_JWKS_POLICY', 'NOT_RUN'],
    ['LOCAL_FEATURE004_JWKS_RETRIEVAL', 'NOT_RUN'],
    ['LOCAL_FEATURE004_DB_MUTATION_STARTED', 'NO']
  ]);
  try {
    const args = parseArguments(process.argv.slice(2));
    validateLocalEnvironment(process.env);
    dependencies = createRuntimeDependencies(process.env.DATABASE_URL);
    const result = await executeLocalFeature007Provisioning({
      ...args,
      dependencies,
      environment: process.env,
      randomUUID,
      report: (marker, value) => diagnostics.set(marker, value)
    });
    process.stdout.write([
      'LOCAL_BRIDGE_JWKS_HARDENED_RETRIEVAL=PASS',
      `LOCAL_FEATURE004_CUSTOMER_STATE=${args.verifyOnly ? 'NOT_EVALUATED' : result.customerState}`,
      `LOCAL_FEATURE004_BINDING_STATE=${args.verifyOnly ? 'NOT_EVALUATED' : result.bindingState}`,
      `LOCAL_FEATURE004_TRUST_PROFILE_STATE=${args.verifyOnly ? 'NOT_EVALUATED' : result.profileState}`
    ].join('\n') + '\n');
  } catch (error) {
    const conflict = error instanceof LocalFeature007ProvisionError && error.message === 'local_feature007_provision_conflict';
    process.stderr.write(`LOCAL_FEATURE004_PROVISIONING=${conflict ? 'CONFLICT' : 'FAILED'}\n`);
    process.exitCode = 1;
  } finally {
    process.stdout.write([...diagnostics].map(([marker, value]) => `${marker}=${value}`).join('\n') + '\n');
    if (dependencies?.client?.$disconnect) await dependencies.client.$disconnect().catch(() => undefined);
  }
}

module.exports = { AUTHORITY, LocalFeature007ProvisionError, parseArguments, executeLocalFeature007Provisioning, validatePublicJwks, createRuntimeDependencies };

if (require.main === module) void main();
