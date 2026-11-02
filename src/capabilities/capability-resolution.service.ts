import { CapabilityBindingResolverService } from './capability-binding-resolver.service';
import { CapabilityCatalogRegistry, type CapabilityCatalogScope } from './capability-catalog.registry';
import type { CapabilityResolutionResultV1, ScopedCapabilityCatalogV1 } from './capability-pack.types';
import {
  CapabilityParameterResolverService,
  freezeCapabilityResolutionResultV1
} from './capability-parameter-resolver.service';
import { CapabilitySemanticResolverService, normalizeCapabilitySemanticText } from './capability-semantic-resolver.service';
import { Inject, Injectable } from '@nestjs/common';
import type { CustomerScope } from '../identity/customer-scope.types';
import type { CapabilityFollowUpFrameV1 } from '../assistant/conversation/conversation.types';
import type { PreCandidateQueryScopeApplicabilityV1 } from '../query-scope/query-scope.types';

export interface CapabilityResolutionAuditMetadataV1 {
  readonly auditContext?: Readonly<{ customerScope: CustomerScope; requestId: string; sessionId: string; messageId: string }>;
  readonly scope: CapabilityCatalogScope;
  readonly packId?: string;
  readonly packVersion?: string;
  readonly outcome: CapabilityResolutionResultV1['outcome'];
  readonly capabilityKey?: string;
  readonly bindingId?: string;
  readonly parameterNames: readonly string[];
  readonly candidateCount: number;
  readonly reasonCode?: string;
  readonly durationMs: number;
}

export interface CapabilityResolutionAuditPort {
  record(metadata: CapabilityResolutionAuditMetadataV1): Promise<void>;
}

export interface CapabilityResolutionInput {
  readonly auditContext?: CapabilityResolutionAuditMetadataV1['auditContext'];
  readonly followUpFrame?: CapabilityFollowUpFrameV1;
  readonly scope: CapabilityCatalogScope;
  readonly text: string;
  readonly currentValues?: Readonly<Record<string, unknown>>;
  readonly pageContextValues?: Readonly<Record<string, unknown>>;
  readonly inheritedValues?: Readonly<Record<string, unknown>>;
}

@Injectable()
export class CapabilityResolutionService {
  constructor(
    private readonly registry: CapabilityCatalogRegistry,
    private readonly semantic: CapabilitySemanticResolverService,
    private readonly parameters: CapabilityParameterResolverService,
    private readonly bindings: CapabilityBindingResolverService,
    @Inject('CapabilityResolutionAuditPort') private readonly audit: CapabilityResolutionAuditPort
  ) {}

  async resolve(input: CapabilityResolutionInput): Promise<CapabilityResolutionResultV1> {
    const started = Date.now();
    const scope: CapabilityCatalogScope = Object.freeze({
      customerId: input.scope.customerId,
      integrationId: input.scope.integrationId,
      hostApp: input.scope.hostApp
    });
    const selected = this.registry.resolveCatalog(scope);
    const catalog = selected.available ? selected.catalog : undefined;
    const result = catalog
      ? await this.resolveSelectedCatalog(catalog, input)
      : notRecognized();
    const closed = freezeCapabilityResolutionResultV1(result);
    try {
      await this.audit.record({ ...auditMetadata(scope, catalog, closed, Date.now() - started),
        ...(input.auditContext ? { auditContext: input.auditContext } : {}) });
    } catch {
      throw new Error('CAPABILITY_RESOLUTION_AUDIT_FAILED');
    }
    return closed;
  }

  /** Reuses current-turn scoped semantics without resolving or releasing a Tool candidate. */
  resolvePreCandidateScopeApplicability(input: Readonly<{
    scope: CapabilityCatalogScope; text: string; sourceMessageId: string;
  }>): PreCandidateQueryScopeApplicabilityV1 | undefined {
    const selected = this.registry.resolveCatalog(input.scope);
    if (!selected.available) return undefined;
    const catalog = selected.catalog;
    const signals: Record<string, readonly string[]> = {};
    for (const capability of catalog.capabilities) {
      if (!capability.active) continue;
      signals[capability.capabilityKey] = this.parameters.resolve({ capability,
        capabilityRef: { packId: catalog.packId, packVersion: catalog.packVersion,
          capabilityKey: capability.capabilityKey, safeLabel: capability.safeLabel },
        text: input.text }).validatedParameterNames;
    }
    const match = this.semantic.resolve({ catalog, text: input.text,
      validatedParameterSignalsByCapability: signals });
    if (match.outcome !== 'MATCHED') return undefined;
    const normalizedText = normalizeCapabilitySemanticText(input.text);
    const explicitTargets = catalog.capabilities.filter((entry) => entry.active &&
      [...(entry.followUpSemanticEvidence?.targetTerms ?? []),
        ...(entry.semanticProfiles.find((profile) => profile.locale === 'zh-TW')?.aliases ?? [])]
        .some((term) => normalizedText.includes(normalizeCapabilitySemanticText(term))));
    if (explicitTargets.length !== 1 || explicitTargets[0].capabilityKey !== match.capability.capabilityKey) return undefined;
    const capability = catalog.capabilities.find((entry) => entry.active &&
      entry.capabilityKey === match.capability.capabilityKey);
    if (!capability) return undefined;
    const parameters = this.parameters.resolve({ capability, capabilityRef: match.capability,
      text: input.text });
    if (parameters.status !== 'VALID') return undefined;
    const binding = this.bindings.resolveApplicableBindingMetadata(catalog, capability.capabilityKey,
      parameters.parameters);
    if (!binding) return undefined;
    return Object.freeze({ version: '1', scope: Object.freeze({ customerId: catalog.customerId,
      integrationId: catalog.integrationId, hostApp: catalog.hostApp }),
    packId: catalog.packId, packVersion: catalog.packVersion, capabilityKey: capability.capabilityKey,
    ...binding, sourceMessageId: input.sourceMessageId,
    evidenceSource: 'CURRENT_SCOPED_SEMANTIC' });
  }

  private async resolveSelectedCatalog(
    catalog: ScopedCapabilityCatalogV1,
    input: CapabilityResolutionInput
  ): Promise<CapabilityResolutionResultV1> {
    if (input.followUpFrame) {
      const frame = input.followUpFrame;
      if (frame.scope.customerId !== catalog.customerId || frame.scope.integrationId !== catalog.integrationId ||
        frame.scope.hostApp !== catalog.hostApp || frame.packId !== catalog.packId || frame.packVersion !== catalog.packVersion) {
        return notRecognized();
      }
      const hinted = catalog.capabilities.find((entry) => entry.active && entry.capabilityKey === frame.capabilityKey);
      if (!hinted) return notRecognized();
      const frameNames = frame.parameters.map((entry) => entry.parameterName);
      if (new Set(frameNames).size !== frameNames.length ||
        frameNames.some((name) => !hinted.parameters.some((parameter) => parameter.parameterName === name))) {
        return notRecognized();
      }
      const reference = { packId: catalog.packId, packVersion: catalog.packVersion,
        capabilityKey: hinted.capabilityKey, safeLabel: hinted.safeLabel };
      const frameValues = Object.fromEntries(frame.parameters.map((entry) => [entry.parameterName, entry.value]));
      const selectedParameters = this.parameters.resolve({ capability: hinted, capabilityRef: reference,
        text: input.text, currentValues: frameValues,
        pageContextValues: input.pageContextValues, inheritedValues: input.inheritedValues });
      return selectedParameters.status === 'ISSUES' ? selectedParameters.result
        : this.bindings.resolve(catalog, hinted.capabilityKey, selectedParameters.parameters);
    }
    const signals: Record<string, readonly string[]> = {};
    for (const capability of catalog.capabilities) {
      if (!capability.active) continue;
      const reference = {
        packId: catalog.packId, packVersion: catalog.packVersion,
        capabilityKey: capability.capabilityKey, safeLabel: capability.safeLabel
      };
      signals[capability.capabilityKey] = this.parameters.resolve({
        capability, capabilityRef: reference, text: input.text,
        currentValues: input.currentValues, pageContextValues: input.pageContextValues,
        inheritedValues: input.inheritedValues
      }).validatedParameterNames;
    }
    const semantic = this.semantic.resolve({
      catalog, text: input.text, validatedParameterSignalsByCapability: signals
    });
    if (semantic.outcome !== 'MATCHED') return semantic;
    const capability = catalog.capabilities.find((entry) =>
      entry.active && entry.capabilityKey === semantic.capability.capabilityKey);
    if (!capability) throw new Error('CAPABILITY_RESOLUTION_INVALID');
    const parameters = this.parameters.resolve({
      capability, capabilityRef: semantic.capability, text: input.text,
      currentValues: input.currentValues, pageContextValues: input.pageContextValues,
      inheritedValues: input.inheritedValues
    });
    if (parameters.status === 'ISSUES') return parameters.result;
    return this.bindings.resolve(catalog, capability.capabilityKey, parameters.parameters);
  }
}

function notRecognized(): Extract<CapabilityResolutionResultV1, { reasonCode: 'CAPABILITY_NOT_RECOGNIZED' }> {
  return {
    version: '1', outcome: 'NEEDS_CLARIFICATION', reasonCode: 'CAPABILITY_NOT_RECOGNIZED',
    missingParameters: [], invalidParameters: [], conflictingParameters: []
  };
}

function auditMetadata(
  scope: CapabilityCatalogScope,
  catalog: ScopedCapabilityCatalogV1 | undefined,
  result: CapabilityResolutionResultV1,
  durationMs: number
): CapabilityResolutionAuditMetadataV1 {
  const parameterNames = result.outcome === 'RESOLVED' || result.outcome === 'CAPABILITY_UNAVAILABLE'
    ? Object.keys(result.parameters)
    : result.outcome === 'NEEDS_CLARIFICATION'
      ? [
          ...result.missingParameters,
          ...result.invalidParameters.map((entry) => entry.parameterName),
          ...result.conflictingParameters.map((entry) => entry.parameterName)
        ]
      : [];
  return Object.freeze({
    scope,
    ...(catalog ? { packId: catalog.packId, packVersion: catalog.packVersion } : {}),
    outcome: result.outcome,
    ...('capability' in result ? { capabilityKey: result.capability.capabilityKey } : {}),
    ...(result.outcome === 'RESOLVED' ? { bindingId: result.bindingRef.bindingId } : {}),
    parameterNames: Object.freeze([...new Set(parameterNames)].sort((a, b) => a.localeCompare(b, 'en-US'))),
    candidateCount: result.outcome === 'AMBIGUOUS' ? result.candidates.length : 'capability' in result ? 1 : 0,
    ...('reasonCode' in result ? { reasonCode: result.reasonCode } : {}),
    durationMs: Math.max(0, Math.min(durationMs, 60_000))
  });
}
