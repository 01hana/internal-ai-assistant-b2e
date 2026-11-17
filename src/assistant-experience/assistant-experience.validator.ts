import { Injectable } from '@nestjs/common';
import { CapabilityBindingResolverService } from '../capabilities/capability-binding-resolver.service';
import { CapabilityCatalogRegistry } from '../capabilities/capability-catalog.registry';
import type { CanonicalParameterValueV1, ScopedCapabilityCatalogV1 } from '../capabilities/capability-pack.types';
import type { AssistantExperiencePayloadV1, ExperienceConfigError } from './assistant-experience.types';

type Params = Readonly<Record<string, CanonicalParameterValueV1>> | undefined;
type Report = (path: string, code: string) => void;

/**
 * Cross-checks a structurally valid payload against the Capability Packs this deployment has loaded.
 * Choices run their declared capability and parameters directly (spec Decision 4), so every declared
 * pair must be declared in the pack and resolve to an active binding. Message text is display-only.
 * Validation is not a user request: it performs no semantic matching, no LLM call and no audit write.
 */
@Injectable()
export class AssistantExperienceValidator {
  constructor(
    private readonly registry: CapabilityCatalogRegistry,
    private readonly bindings: CapabilityBindingResolverService
  ) {}

  async validate(payload: AssistantExperiencePayloadV1): Promise<readonly ExperienceConfigError[]> {
    const errors: ExperienceConfigError[] = [];
    const err: Report = (path, code) => errors.push({ path, code });
    const catalogs: ScopedCapabilityCatalogV1[] = [];
    payload.hostApps.forEach((hostApp, index) => {
      const selected = this.registry.resolveCatalog({ customerId: payload.customerId,
        integrationId: payload.integrationId, hostApp });
      if (selected.available) catalogs.push(selected.catalog);
      else err(`$.hostApps[${index}]`, 'NO_ACTIVE_PACK');
    });
    if (errors.length > 0) return Object.freeze(errors);

    for (const [index, reply] of payload.quickReplies.entries()) {
      if (reply.kind !== 'capability') continue;
      const path = `$.quickReplies[${index}]`;
      if (this.declared(catalogs, reply.capabilityKey, reply.parameters, path, 'capabilityKey', 'parameters', err)) {
        await this.bindable(catalogs, reply.capabilityKey, reply.parameters, path, err);
      }
    }
    for (const [index, followUp] of payload.followUps.entries()) {
      const path = `$.followUps[${index}]`;
      this.declared(catalogs, followUp.whenCapabilityKey, followUp.whenParameters, path, 'whenCapabilityKey', 'whenParameters', err);
      if (this.declared(catalogs, followUp.capabilityKey, followUp.parameters, path, 'capabilityKey', 'parameters', err)) {
        await this.bindable(catalogs, followUp.capabilityKey, followUp.parameters, path, err);
      }
    }
    return Object.freeze(errors);
  }

  /** The capability and every parameter value must be declared and active in every targeted pack. */
  private declared(catalogs: readonly ScopedCapabilityCatalogV1[], capabilityKey: string, parameters: Params,
    path: string, keyField: string, parametersField: string, err: Report): boolean {
    let ok = true;
    for (const catalog of catalogs) {
      const capability = catalog.capabilities.find((item) => item.active && item.capabilityKey === capabilityKey);
      if (!capability) { err(`${path}.${keyField}`, 'CAPABILITY_NOT_IN_PACK'); return false; }
      for (const [name, value] of Object.entries(parameters ?? {})) {
        const parameter = capability.parameters.find((item) => item.parameterName === name);
        if (!parameter) { err(`${path}.${parametersField}.${name}`, 'PARAMETER_NOT_DECLARED'); ok = false; }
        else if (parameter.type === 'enum' && !parameter.values.some((item) => item.value === value)) {
          err(`${path}.${parametersField}.${name}`, 'PARAMETER_VALUE_NOT_DECLARED'); ok = false;
        }
      }
    }
    return ok;
  }

  /** The declared capability and parameters must select an active binding in every targeted pack. */
  private async bindable(catalogs: readonly ScopedCapabilityCatalogV1[], capabilityKey: string, parameters: Params,
    path: string, err: Report): Promise<void> {
    for (const catalog of catalogs) {
      let outcome: string;
      try { outcome = (await this.bindings.resolve(catalog, capabilityKey, { ...(parameters ?? {}) })).outcome; }
      catch { outcome = 'ERROR'; }
      if (outcome !== 'RESOLVED') { err(`${path}.parameters`, 'PARAMETERS_NOT_BOUND'); return; }
    }
  }
}
