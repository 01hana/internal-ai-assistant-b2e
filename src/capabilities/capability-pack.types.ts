export type SemanticSignalGroup = 'resource' | 'intent' | 'metric';

export interface CustomerCapabilityPackV1 {
  readonly version: '1';
  readonly packId: string;
  readonly packVersion: string;
  readonly customerId: string;
  readonly integrationId: string;
  readonly hostApps: readonly string[];
  readonly active: boolean;
  readonly capabilities: readonly CapabilityDefinitionV1[];
  readonly bindings: readonly CapabilityBindingV1[];
}

export interface CapabilityDefinitionV1 {
  readonly version: '1';
  readonly capabilityKey: string;
  readonly active: boolean;
  readonly kind: 'READ_ONLY_TOOL';
  readonly safeLabel: string;
  readonly semanticProfiles: readonly CapabilitySemanticMetadataV1[];
  readonly parameters: readonly CapabilityParameterDefinitionV1[];
}

export interface CapabilitySemanticMetadataV1 {
  readonly version: '1';
  readonly locale: string;
  readonly aliases: readonly string[];
  readonly examples: readonly string[];
  readonly resourceTerms: readonly string[];
  readonly intentTerms: readonly string[];
  readonly metricTerms: readonly string[];
  readonly requiredSignalGroups: readonly SemanticSignalGroup[];
}

export interface EnumCapabilityParameterValueV1 {
  readonly value: string;
  readonly aliases: readonly string[];
}

export interface EnumCapabilityParameterV1 {
  readonly version: '1';
  readonly parameterName: string;
  readonly type: 'enum';
  readonly required: boolean;
  readonly semanticTerms: readonly string[];
  readonly values: readonly EnumCapabilityParameterValueV1[];
}

export interface BoundedStringCapabilityParameterV1 {
  readonly version: '1';
  readonly parameterName: string;
  readonly type: 'bounded_string';
  readonly required: boolean;
  readonly semanticTerms: readonly string[];
  readonly maxLength: number;
  readonly tokenSyntax: 'SAFE_IDENTIFIER';
  readonly prefixes: readonly string[];
}

export type CapabilityParameterDefinitionV1 =
  | EnumCapabilityParameterV1
  | BoundedStringCapabilityParameterV1;

export interface CapabilityBindingSemanticConstraintV1 {
  readonly version: '1';
  readonly parameterName: string;
  readonly operator: 'ENUM_VALUE_IN';
  readonly allowedValues: readonly string[];
}

export interface CapabilityToolTargetV1 {
  readonly kind: 'TOOL';
  readonly toolKey: string;
  readonly toolVersion: string;
}

export interface CapabilityParameterMappingV1 {
  readonly version: '1';
  readonly targetArgument: string;
  readonly source: 'CANONICAL_PARAMETER';
  readonly parameterName: string;
}

export interface CapabilityBoundConstantMappingV1 {
  readonly version: '1';
  readonly targetArgument: string;
  readonly source: 'BOUND_CONSTANT';
  readonly value: string | number | boolean;
}

export type CapabilityBindingMappingV1 =
  | CapabilityParameterMappingV1
  | CapabilityBoundConstantMappingV1;

export interface CapabilityBindingV1 {
  readonly version: '1';
  readonly bindingId: string;
  readonly bindingVersion: string;
  readonly active: boolean;
  readonly capabilityKey: string;
  readonly semanticConstraints: readonly CapabilityBindingSemanticConstraintV1[];
  readonly target: CapabilityToolTargetV1;
  readonly mappings: readonly CapabilityBindingMappingV1[];
}

export interface ScopedCapabilityCatalogV1 {
  readonly version: '1';
  readonly packId: string;
  readonly packVersion: string;
  readonly customerId: string;
  readonly integrationId: string;
  readonly hostApp: string;
  readonly capabilities: readonly CapabilityDefinitionV1[];
  readonly bindings: readonly CapabilityBindingV1[];
}

export interface CapabilityRefV1 {
  readonly packId: string;
  readonly packVersion: string;
  readonly capabilityKey: string;
  readonly safeLabel: string;
}

export type CanonicalParameterValueV1 = string | number | boolean;

export type CapabilityResolutionResultV1 =
  | {
      readonly version: '1';
      readonly outcome: 'RESOLVED';
      readonly capability: CapabilityRefV1;
      readonly parameters: Readonly<Record<string, CanonicalParameterValueV1>>;
      readonly bindingRef: { readonly bindingId: string; readonly bindingVersion: string };
      readonly toolCandidate: {
        readonly key: string;
        readonly version: string;
        readonly arguments: Readonly<Record<string, unknown>>;
        readonly reason: 'customer_capability_binding';
      };
    }
  | {
      readonly version: '1';
      readonly outcome: 'NEEDS_CLARIFICATION';
      readonly reasonCode: 'CAPABILITY_NOT_RECOGNIZED';
      readonly missingParameters: readonly [];
      readonly invalidParameters: readonly [];
      readonly conflictingParameters: readonly [];
    }
  | {
      readonly version: '1';
      readonly outcome: 'NEEDS_CLARIFICATION';
      readonly capability: CapabilityRefV1;
      readonly reasonCode: 'PARAMETER_ISSUES';
      readonly missingParameters: readonly string[];
      readonly invalidParameters: readonly { readonly parameterName: string; readonly reasonCode: string }[];
      readonly conflictingParameters: readonly { readonly parameterName: string; readonly candidateCount: number }[];
    }
  | {
      readonly version: '1';
      readonly outcome: 'CAPABILITY_UNAVAILABLE';
      readonly capability: CapabilityRefV1;
      readonly parameters: Readonly<Record<string, CanonicalParameterValueV1>>;
      readonly reasonCode: 'NO_COMPATIBLE_ACTIVE_BINDING';
    }
  | {
      readonly version: '1';
      readonly outcome: 'AMBIGUOUS';
      readonly reasonCode: 'MULTIPLE_CAPABILITIES';
      readonly candidates: readonly CapabilityRefV1[];
    };
