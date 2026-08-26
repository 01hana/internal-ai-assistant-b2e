import {
  ManagedExchangeCredentialError,
  ManagedExchangeIdentityDeniedError,
  ManagedExchangeInfrastructureError,
  ManagedExchangeIssuanceError,
  ManagedExchangeRequestError,
  type IdentityProviderAdapterRegistry,
  type IntegrationAdmissionPort,
  type ManagedCanonicalizationPort,
  type ManagedExchangeAuditPort,
  type ManagedTokenIssuer,
  type ProviderInstancePolicy,
  type VerifiedExternalIdentity
} from './domain/managed-exchange.domain';
import type { ManagedPermissionService } from './permissions/managed-permission.service';
import type {
  ManagedIdentityProviderInstanceRecord,
  ManagedIntegrationExchangeConfigRecord,
  ManagedIntegrationExchangeConfigRepository,
  ManagedIdentityProviderInstanceRepository,
  ManagedPermissionPolicyRecord,
  ManagedPermissionPolicyRepository
} from './persistence/managed-exchange.repository';

type Config = Pick<ManagedIntegrationExchangeConfigRecord, 'id' | 'integrationId' | 'providerInstanceId' | 'canonicalHostApp'>;
type Provider = Pick<ManagedIdentityProviderInstanceRecord,
  'id' | 'providerType' | 'endpointUri' | 'httpMethod' | 'credentialPlacement' | 'timeoutMilliseconds' |
  'responseContractVersion' | 'contractConfig' | 'declaredAnchorKinds'>;
type Policy = ManagedPermissionPolicyRecord;

export type ManagedExchangeInput = Readonly<{ integrationSelector: string; nativeCredential: string; requestId: string }>;
export type ManagedExchangeResult = Readonly<{ accessToken: string; tokenType: 'Bearer'; expiresIn: number }>;
type AuditContext = { requestId: string; integrationId?: string; integrationConfigId?: string; providerType?: string; providerInstanceId?: string; jti?: string; kid?: string };

/** Minimal authority-preserving composition of the established managed exchange ports. */
export class ManagedIdentityExchangeService {
  constructor(private readonly dependencies: Readonly<{
    configs: Pick<ManagedIntegrationExchangeConfigRepository, 'findEnabledActiveByPublicSelector'>;
    providers: Pick<ManagedIdentityProviderInstanceRepository, 'findEnabledActiveById'>;
    readiness: Readonly<{ assertReady(integrationId: string): Promise<void> }>;
    providerAdapters: IdentityProviderAdapterRegistry;
    admission: IntegrationAdmissionPort;
    permissionPolicies: Pick<ManagedPermissionPolicyRepository, 'findEnabledActiveByConfigId'>;
    permissions: Pick<ManagedPermissionService, 'resolve'>;
    canonicalizer: ManagedCanonicalizationPort;
    issuer: ManagedTokenIssuer;
    audit: ManagedExchangeAuditPort;
  }>) {}

  async exchange(input: ManagedExchangeInput): Promise<ManagedExchangeResult> {
    const request = requestInput(input);
    const context: AuditContext = { requestId: request.requestId };
    let successAuditStarted = false;
    try {
      const config = await this.config(request.integrationSelector);
      Object.assign(context, { integrationId: config.integrationId, integrationConfigId: config.id });
      const provider = await this.provider(config.providerInstanceId);
      Object.assign(context, { providerType: provider.providerType, providerInstanceId: provider.id });
      await this.ready(config.integrationId);
      const adapter = this.adapter(provider.providerType);
      const identity = await this.verify(adapter, request.nativeCredential, providerPolicy(provider), request.requestId);
      await this.admit(identity, config.id);
      const policy = await this.policy(config.id);
      const scopes = await this.permissions(identity, config, request.requestId, policy);
      const canonical = await this.canonicalize(identity, config.id, scopes);
      const issued = await this.issue(canonical);
      Object.assign(context, { jti: issued.jti, kid: issued.kid });
      successAuditStarted = true;
      await this.auditSuccess(context);
      return Object.freeze({ accessToken: issued.accessToken, tokenType: issued.tokenType, expiresIn: issued.expiresIn });
    } catch (error) {
      if (successAuditStarted) throw new ManagedExchangeInfrastructureError();
      const original = runtimeError(error);
      try { await this.auditFailure(context, original); } catch { throw new ManagedExchangeInfrastructureError(); }
      throw original;
    }
  }

  private async config(selector: string): Promise<Config> {
    try {
      const config = await this.dependencies.configs.findEnabledActiveByPublicSelector(selector);
      if (!config) throw new ManagedExchangeCredentialError();
      return config;
    } catch (error) {
      if (error instanceof ManagedExchangeCredentialError) throw error;
      throw new ManagedExchangeInfrastructureError();
    }
  }

  private async provider(id: string): Promise<Provider> {
    try {
      const provider = await this.dependencies.providers.findEnabledActiveById(id);
      if (!provider) throw new ManagedExchangeInfrastructureError();
      return provider;
    } catch {
      throw new ManagedExchangeInfrastructureError();
    }
  }

  private async ready(integrationId: string): Promise<void> {
    try { await this.dependencies.readiness.assertReady(integrationId); } catch { throw new ManagedExchangeInfrastructureError(); }
  }

  private adapter(providerType: string) {
    try {
      const adapter = this.dependencies.providerAdapters.resolve(providerType);
      if (!adapter) throw new ManagedExchangeInfrastructureError();
      return adapter;
    } catch {
      throw new ManagedExchangeInfrastructureError();
    }
  }

  private async verify(adapter: Readonly<{ verify(input: Readonly<{ nativeCredential: string; providerInstancePolicy: ProviderInstancePolicy; requestId: string }>): Promise<VerifiedExternalIdentity> }>, nativeCredential: string, providerInstancePolicy: ProviderInstancePolicy, requestId: string): Promise<VerifiedExternalIdentity> {
    try { return await adapter.verify({ nativeCredential, providerInstancePolicy, requestId }); }
    catch (error) {
      if (error instanceof ManagedExchangeCredentialError || error instanceof ManagedExchangeIdentityDeniedError || error instanceof ManagedExchangeInfrastructureError) throw error;
      throw new ManagedExchangeInfrastructureError();
    }
  }

  private async admit(identity: VerifiedExternalIdentity, integrationConfigId: string): Promise<void> {
    try { await this.dependencies.admission.admit({ identity, integrationConfigId }); }
    catch (error) {
      if (error instanceof ManagedExchangeIdentityDeniedError) throw new ManagedExchangeCredentialError();
      if (error instanceof ManagedExchangeInfrastructureError) throw error;
      throw new ManagedExchangeInfrastructureError();
    }
  }

  private async policy(integrationConfigId: string): Promise<Policy> {
    try {
      const policies = await this.dependencies.permissionPolicies.findEnabledActiveByConfigId(integrationConfigId);
      if (policies.length !== 1) throw new ManagedExchangeInfrastructureError();
      return policies[0];
    } catch (error) {
      if (error instanceof ManagedExchangeInfrastructureError) throw error;
      throw new ManagedExchangeInfrastructureError();
    }
  }

  private async permissions(admittedIdentity: VerifiedExternalIdentity, config: Config, requestId: string, policy: Policy): Promise<readonly string[]> {
    try {
      return await this.dependencies.permissions.resolve({
        admittedIdentity, integrationConfigId: config.id, requestId, policy,
        serverOwnedIntegrationContext: Object.freeze({ integrationId: config.integrationId, hostApp: config.canonicalHostApp })
      });
    } catch (error) {
      if (error instanceof ManagedExchangeIdentityDeniedError || error instanceof ManagedExchangeInfrastructureError) throw error;
      throw new ManagedExchangeInfrastructureError();
    }
  }

  private async canonicalize(identity: VerifiedExternalIdentity, integrationConfigId: string, permissionScopes: readonly string[]) {
    try { return await this.dependencies.canonicalizer.canonicalize({ identity, integrationConfigId, permissionScopes }); }
    catch (error) {
      if (error instanceof ManagedExchangeIdentityDeniedError || error instanceof ManagedExchangeInfrastructureError) throw error;
      throw new ManagedExchangeInfrastructureError();
    }
  }

  private async issue(identity: Parameters<ManagedTokenIssuer['issue']>[0]) {
    try { return await this.dependencies.issuer.issue(identity); }
    catch (error) {
      if (error instanceof ManagedExchangeInfrastructureError || error instanceof ManagedExchangeIssuanceError) throw error;
      throw new ManagedExchangeIssuanceError();
    }
  }

  private async auditSuccess(context: AuditContext): Promise<void> {
    try {
      await this.dependencies.audit.append({
        ...context, outcome: 'success', reasonCode: 'managed_exchange_issued'
      });
    } catch { throw new ManagedExchangeInfrastructureError(); }
  }

  private async auditFailure(context: AuditContext, error: ManagedExchangeCredentialError | ManagedExchangeIdentityDeniedError | ManagedExchangeInfrastructureError | ManagedExchangeIssuanceError): Promise<void> {
    const event = error instanceof ManagedExchangeCredentialError
      ? { outcome: 'denied' as const, reasonCode: 'managed_exchange_identity_invalid' }
      : error instanceof ManagedExchangeIdentityDeniedError
        ? { outcome: 'denied' as const, reasonCode: 'managed_exchange_identity_denied' }
        : error instanceof ManagedExchangeIssuanceError
          ? { outcome: 'unavailable' as const, reasonCode: 'managed_exchange_issuance_failed' }
          : { outcome: 'unavailable' as const, reasonCode: 'managed_exchange_unavailable' };
    await this.dependencies.audit.append({ ...context, ...event });
  }
}

function runtimeError(error: unknown): ManagedExchangeCredentialError | ManagedExchangeIdentityDeniedError | ManagedExchangeInfrastructureError | ManagedExchangeIssuanceError {
  if (error instanceof ManagedExchangeCredentialError || error instanceof ManagedExchangeIdentityDeniedError || error instanceof ManagedExchangeInfrastructureError || error instanceof ManagedExchangeIssuanceError) return error;
  return new ManagedExchangeInfrastructureError();
}

function requestInput(value: ManagedExchangeInput): ManagedExchangeInput {
  if (!record(value)) throw new ManagedExchangeRequestError();
  return Object.freeze({
    integrationSelector: text(value.integrationSelector), nativeCredential: text(value.nativeCredential), requestId: text(value.requestId)
  });
}

function providerPolicy(value: Provider): ProviderInstancePolicy {
  try {
    if (!Array.isArray(value.declaredAnchorKinds) || !record(value.contractConfig)) throw new Error('invalid provider');
    return Object.freeze({
      id: text(value.id), providerType: text(value.providerType), endpointUri: text(value.endpointUri), httpMethod: text(value.httpMethod),
      credentialPlacement: text(value.credentialPlacement), timeoutMilliseconds: timeout(value.timeoutMilliseconds), responseContractVersion: text(value.responseContractVersion),
      declaredAnchorKinds: Object.freeze(value.declaredAnchorKinds.map(text)), providerContract: Object.freeze({ ...value.contractConfig })
    });
  } catch {
    throw new ManagedExchangeInfrastructureError();
  }
}

function timeout(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) throw new ManagedExchangeInfrastructureError();
  return value;
}

function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || control(value)) throw new ManagedExchangeRequestError();
  return value;
}

function record(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function control(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 31 || code === 127;
  });
}
