import { GatewayIdentityAuditWriter } from '../audit/gateway-identity-audit.writer';
import { IntegrationBindingRepository, type GatewayRegistryTransaction } from '../integration-registry/integration-binding.repository';

export type ProvisionIntegrationBindingInput = Readonly<{
  customerId: string;
  integrationId: string;
  allowedHostApp: string;
  enabled: boolean;
  requestId: string;
}>;

export type ProvisionIntegrationBindingResult = Readonly<{
  integrationId: string;
  customerId: string;
  allowedHostApp: string;
  enabled: boolean;
  changed: boolean;
}>;

/**
 * Internal/direct-only command. There is intentionally no controller or HTTP
 * route for provisioning Customer bindings.
 */
export class ProvisionIntegrationBindingCommand {
  constructor(private readonly service: ProvisionIntegrationBindingService) {}

  execute(input: ProvisionIntegrationBindingInput): Promise<ProvisionIntegrationBindingResult> {
    return this.service.provision(input);
  }
}

export class ProvisionIntegrationBindingService {
  constructor(private readonly repository: IntegrationBindingRepository) {}

  async provision(input: ProvisionIntegrationBindingInput): Promise<ProvisionIntegrationBindingResult> {
    const normalized = normalizeInput(input);
    try {
      return await this.repository.transaction(async (transaction) => {
        const customer = await transaction.customer.findUnique({ where: { id: normalized.customerId } });
        if (!customer) throw new ProvisioningDenied('unknown_customer');

        const existing = await transaction.integrationBinding.findUnique({ where: { integrationId: normalized.integrationId } });
        if (existing && (existing.customerId !== normalized.customerId || existing.allowedHostApp !== normalized.allowedHostApp)) {
          throw new ProvisioningDenied('binding_conflict');
        }

        if (!existing) {
          const binding = await transaction.integrationBinding.create({
            data: {
              integrationId: normalized.integrationId,
              customerId: normalized.customerId,
              allowedHostApp: normalized.allowedHostApp,
              enabled: normalized.enabled
            }
          });
          await this.append(transaction, normalized, 'integration_binding_provisioned', 'created');
          return result(binding, true);
        }

        if (existing.enabled === normalized.enabled) {
          await this.append(transaction, normalized, 'integration_binding_provisioned', 'replayed');
          return result(existing, false);
        }

        const binding = await transaction.integrationBinding.update({
          where: { integrationId: normalized.integrationId },
          data: { enabled: normalized.enabled }
        });
        await this.append(transaction, normalized, normalized.enabled ? 'integration_binding_enabled' : 'integration_binding_disabled', 'updated');
        return result(binding, true);
      });
    } catch (error) {
      if (error instanceof ProvisioningDenied) {
        await this.appendDenial(normalized, error.reasonCode);
        throw new ProvisionIntegrationBindingError();
      }
      throw error;
    }
  }

  private append(transaction: GatewayRegistryTransaction, input: NormalizedProvisioningInput, eventType: string, reasonCode: string) {
    return new GatewayIdentityAuditWriter(transaction).append({
      requestId: input.requestId,
      eventType,
      outcome: 'success',
      reasonCode,
      customerId: input.customerId,
      integrationId: input.integrationId,
      hostApp: input.allowedHostApp
    });
  }

  private appendDenial(input: NormalizedProvisioningInput, reasonCode: string) {
    return new GatewayIdentityAuditWriter(this.repository.auditClient()).append({
      requestId: input.requestId,
      eventType: 'integration_binding_provisioning_denied',
      outcome: 'denied',
      reasonCode,
      integrationId: input.integrationId,
      hostApp: input.allowedHostApp
    });
  }

}

type NormalizedProvisioningInput = Readonly<{
  customerId: string;
  integrationId: string;
  allowedHostApp: string;
  enabled: boolean;
  requestId: string;
}>;

function normalizeInput(input: ProvisionIntegrationBindingInput): NormalizedProvisioningInput {
  if (typeof input.enabled !== 'boolean') throw new ProvisionIntegrationBindingError();
  return {
    customerId: required(input.customerId),
    integrationId: required(input.integrationId),
    allowedHostApp: required(input.allowedHostApp),
    enabled: input.enabled,
    requestId: required(input.requestId)
  };
}

function required(value: string): string {
  if (typeof value !== 'string' || !value.trim() || containsControlCharacter(value)) throw new ProvisionIntegrationBindingError();
  return value.trim();
}

function result(binding: { integrationId: string; customerId: string; allowedHostApp: string; enabled: boolean }, changed: boolean): ProvisionIntegrationBindingResult {
  return Object.freeze({ integrationId: binding.integrationId, customerId: binding.customerId, allowedHostApp: binding.allowedHostApp, enabled: binding.enabled, changed });
}

class ProvisioningDenied extends Error {
  constructor(readonly reasonCode: 'unknown_customer' | 'binding_conflict') { super(reasonCode); }
}

export class ProvisionIntegrationBindingError extends Error {
  constructor() { super('Integration binding provisioning cannot be completed.'); }
}

function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 31 || code === 127;
  });
}
