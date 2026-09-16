import { Injectable } from '@nestjs/common';
import type { CustomerScope } from '../identity/customer-scope.types';
import type {
  QueryUnderstandingClarificationNeed,
  QueryUnderstandingEntityCandidate,
  QueryUnderstandingNormalizedTerm,
  QueryUnderstandingPhrase,
  QueryUnderstandingTimeRange,
  QueryUnderstandingToolCandidate
} from '../query-understanding/query-understanding.types';
import type {
  RegisteredToolDefinition,
  ToolDiscoveryArgumentBindingV1,
  ToolDiscoveryConceptGroup,
  ToolDiscoveryMetadataV1
} from './tool-registry.types';
import { ToolRegistryService } from './tool-registry.service';

const EXTENSION = 'x-assistant-discovery-v1';
const METADATA_KEYS = new Set([
  'version', 'locale', 'resourceConcepts', 'intentConcepts', 'metricConcepts',
  'timeRangeConcepts', 'requiredConceptGroups', 'argumentBindings', 'taskType', 'requiredEvidence'
]);
const BINDING_KEYS = new Set(['argumentName', 'source', 'concepts']);
const GROUPS = new Set<ToolDiscoveryConceptGroup>(['resource', 'intent', 'metric', 'timeRange']);
const SOURCES = new Set(['entity_value', 'normalized_term', 'time_range_label']);
const SAFE_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const FORBIDDEN = /(customer|hostapp|connector|adapter|endpoint|credential|password|secret|token|sql|command|callback|script|https?|uri|url|path)/i;
const EVIDENCE = new Set(['identity_context', 'structured_record', 'manual_review', 'document_chunk']);
export const POLICY_DENIED_DISCOVERY_REASON = 'metadata_discovery_policy_denied' as const;

export interface ToolDiscoveryInput {
  readonly customerScope: Readonly<Pick<CustomerScope, 'customerId'>>;
  readonly normalizedTerms: readonly QueryUnderstandingNormalizedTerm[];
  readonly phrases: readonly QueryUnderstandingPhrase[];
  readonly timeRanges: readonly QueryUnderstandingTimeRange[];
  readonly entityCandidates: readonly QueryUnderstandingEntityCandidate[];
}

export interface ToolDiscoveryResult {
  readonly candidates: readonly QueryUnderstandingToolCandidate[];
  readonly taskType: string;
  readonly requiredEvidence: readonly string[];
  readonly matchConfidence: number;
  readonly clarificationNeeds: readonly QueryUnderstandingClarificationNeed[];
  readonly discoveredTaskTypes: readonly string[];
}

interface ScoredCandidate {
  readonly tool: RegisteredToolDefinition;
  readonly metadata: ToolDiscoveryMetadataV1;
  readonly candidate: QueryUnderstandingToolCandidate;
  readonly anchor: string;
  readonly requiredMatches: number;
  readonly optionalCoverage: number;
}

@Injectable()
export class ToolDiscoveryService {
  constructor(private readonly tools: ToolRegistryService) {}

  async discover(input: ToolDiscoveryInput): Promise<ToolDiscoveryResult> {
    const catalog = await this.tools.listDiscoveryCatalogForCustomer(input.customerScope);
    const signals = collectSignals(input);
    const allowed = this.discoverFromCatalog(catalog.allowed, input, signals, 'metadata_discovery');
    if (allowed.candidates.length > 0 || allowed.clarificationNeeds.length > 0) return allowed;

    const explicitlyDenied = this.discoverFromCatalog(
      catalog.explicitlyDenied,
      input,
      signals,
      POLICY_DENIED_DISCOVERY_REASON
    );
    return explicitlyDenied.candidates.length > 0 ? explicitlyDenied : empty();
  }

  private discoverFromCatalog(
    catalog: readonly RegisteredToolDefinition[],
    input: ToolDiscoveryInput,
    signals: Signals,
    reason: 'metadata_discovery' | typeof POLICY_DENIED_DISCOVERY_REASON
  ): ToolDiscoveryResult {
    const scored: ScoredCandidate[] = [];
    const blockedMatches: ToolDiscoveryMetadataV1[] = [];
    for (const tool of catalog) {
      const metadata = parseToolDiscoveryMetadataV1(tool.inputSchema);
      if (!metadata || !requiredGroupsMatch(metadata, signals)) continue;
      if (hasConflictingWriteIntent(metadata, signals)) continue;
      const argumentsValue = bindArguments(metadata.argumentBindings, input);
      if (!argumentsValue) { blockedMatches.push(metadata); continue; }
      const candidate = Object.freeze({ key: tool.key, arguments: argumentsValue, reason });
      if (!this.tools.validateNamedOperation(tool, candidate).valid) { blockedMatches.push(metadata); continue; }
      scored.push({
        tool,
        metadata,
        candidate,
        anchor: anchorFor(metadata, signals),
        requiredMatches: requiredMatchCount(metadata, signals),
        optionalCoverage: optionalCoverage(metadata, signals)
      });
    }

    const selected: ScoredCandidate[] = [];
    for (const group of groupByAnchor(scored).values()) {
      const ranked = [...group].sort((left, right) =>
        right.requiredMatches - left.requiredMatches ||
        right.optionalCoverage - left.optionalCoverage ||
        left.tool.key.localeCompare(right.tool.key) ||
        left.tool.version.localeCompare(right.tool.version)
      );
      if (
        ranked.length > 1 &&
        ranked[0].requiredMatches === ranked[1].requiredMatches &&
        ranked[0].optionalCoverage - ranked[1].optionalCoverage <= 0.05
      ) return ambiguity();
      if (ranked[0]) selected.push(ranked[0]);
    }
    selected.sort((left, right) => left.anchor.localeCompare(right.anchor) || left.tool.key.localeCompare(right.tool.key));
    if (selected.length === 0) return blockedMatches.length > 0 ? blocked(blockedMatches[0]) : empty();
    return Object.freeze({
      candidates: Object.freeze(selected.map(({ candidate }) => candidate)),
      taskType: selected.length > 1 ? 'multi_intent_lookup' : selected[0].metadata.taskType,
      requiredEvidence: Object.freeze([...new Set(selected.flatMap(({ metadata }) => metadata.requiredEvidence))]),
      matchConfidence: 0.95,
      clarificationNeeds: Object.freeze([]),
      discoveredTaskTypes: Object.freeze(selected.map(({ metadata }) => metadata.taskType))
    });
  }
}

export function parseToolDiscoveryMetadataV1(inputSchema: unknown): ToolDiscoveryMetadataV1 | undefined {
  if (!isRecord(inputSchema) || !isRecord(inputSchema[EXTENSION])) return undefined;
  const value = inputSchema[EXTENSION];
  if (!hasExactKeys(value, METADATA_KEYS) || value.version !== '1' || value.locale !== 'zh-TW') return undefined;
  const resourceConcepts = concepts(value.resourceConcepts);
  const intentConcepts = concepts(value.intentConcepts);
  const metricConcepts = concepts(value.metricConcepts);
  const timeRangeConcepts = concepts(value.timeRangeConcepts);
  if (!resourceConcepts || !intentConcepts || !metricConcepts || !timeRangeConcepts) return undefined;
  const requiredConceptGroups = stringArray(value.requiredConceptGroups, 1, 4);
  if (!requiredConceptGroups || !requiredConceptGroups.every((group): group is ToolDiscoveryConceptGroup => GROUPS.has(group as ToolDiscoveryConceptGroup))) return undefined;
  for (const group of requiredConceptGroups) if (conceptsForGroup({ resourceConcepts, intentConcepts, metricConcepts, timeRangeConcepts }, group).length === 0) return undefined;
  if (!Array.isArray(value.argumentBindings) || value.argumentBindings.length > 16) return undefined;
  const properties = isRecord(inputSchema.properties) ? inputSchema.properties : undefined;
  if (!properties) return undefined;
  const argumentBindings: ToolDiscoveryArgumentBindingV1[] = [];
  const targets = new Set<string>();
  for (const entry of value.argumentBindings) {
    if (!isRecord(entry) || !hasExactKeys(entry, BINDING_KEYS) || !safeArgumentName(entry.argumentName) || !SOURCES.has(String(entry.source))) return undefined;
    if (!Object.prototype.hasOwnProperty.call(properties, entry.argumentName) || targets.has(entry.argumentName)) return undefined;
    const bindingConcepts = bindingConceptValues(entry.source, entry.concepts);
    if (!bindingConcepts) return undefined;
    targets.add(entry.argumentName);
    argumentBindings.push(Object.freeze({ argumentName: entry.argumentName, source: entry.source as ToolDiscoveryArgumentBindingV1['source'], concepts: bindingConcepts }));
  }
  if (!safeName(value.taskType)) return undefined;
  const requiredEvidence = stringArray(value.requiredEvidence, 0, 8);
  if (!requiredEvidence || !requiredEvidence.every((entry) => EVIDENCE.has(entry))) return undefined;
  return Object.freeze({
    version: '1', locale: 'zh-TW', resourceConcepts, intentConcepts, metricConcepts,
    timeRangeConcepts, requiredConceptGroups: Object.freeze(requiredConceptGroups),
    argumentBindings: Object.freeze(argumentBindings), taskType: value.taskType,
    requiredEvidence: Object.freeze(requiredEvidence)
  });
}

type Signals = Readonly<Record<ToolDiscoveryConceptGroup, ReadonlySet<string>>>;

function collectSignals(input: ToolDiscoveryInput): Signals {
  const resource = new Set<string>();
  const intent = new Set<string>();
  const metric = new Set<string>();
  const timeRange = new Set<string>();
  for (const term of input.normalizedTerms) {
    if (term.confidence < 0.8) continue;
    if (term.category === 'resource') resource.add(term.normalizedTerm);
    if (term.category === 'operation') intent.add(term.normalizedTerm);
    if (term.category === 'metric') metric.add(term.normalizedTerm);
    if (term.category === 'time') timeRange.add(term.normalizedTerm);
  }
  for (const phrase of input.phrases) {
    if (phrase.category === 'resource') resource.add(phrase.normalizedValue);
    if (phrase.category === 'intent') intent.add(phrase.normalizedValue);
    if (phrase.category === 'metric') metric.add(phrase.normalizedValue);
    if (phrase.category === 'time') timeRange.add(phrase.normalizedValue);
  }
  for (const range of input.timeRanges) timeRange.add(range.label);
  for (const entity of input.entityCandidates) {
    if (entity.confidence < 0.8) continue;
    if (entity.type === 'orderId') resource.add('order');
    if (entity.type === 'workOrderId') resource.add('workOrder');
    if (entity.type === 'itemSku') { resource.add('inventory'); resource.add('stock'); }
    if (entity.type === 'customerId' || entity.type === 'supplierId') resource.add('businessPartner');
  }
  return Object.freeze({ resource, intent, metric, timeRange });
}

function requiredGroupsMatch(metadata: ToolDiscoveryMetadataV1, signals: Signals): boolean {
  return metadata.requiredConceptGroups.every((group) => conceptsForGroup(metadata, group).some((concept) => signals[group].has(concept)));
}

function hasConflictingWriteIntent(metadata: ToolDiscoveryMetadataV1, signals: Signals): boolean {
  const writeSignals = ['update', 'cancel', 'approve', 'delete'].filter((value) => signals.intent.has(value));
  return writeSignals.length > 0 && !writeSignals.some((value) => metadata.intentConcepts.includes(value));
}

function conceptsForGroup(metadata: Pick<ToolDiscoveryMetadataV1, 'resourceConcepts'|'intentConcepts'|'metricConcepts'|'timeRangeConcepts'>, group: ToolDiscoveryConceptGroup): readonly string[] {
  if (group === 'resource') return metadata.resourceConcepts;
  if (group === 'intent') return metadata.intentConcepts;
  if (group === 'metric') return metadata.metricConcepts;
  return metadata.timeRangeConcepts;
}

function optionalCoverage(metadata: ToolDiscoveryMetadataV1, signals: Signals): number {
  const optional = ([...GROUPS] as ToolDiscoveryConceptGroup[]).filter((group) => !metadata.requiredConceptGroups.includes(group));
  const declared = optional.flatMap((group) => conceptsForGroup(metadata, group).map((concept) => [group, concept] as const));
  if (declared.length === 0) return 1;
  return declared.filter(([group, concept]) => signals[group].has(concept)).length / declared.length;
}

function requiredMatchCount(metadata: ToolDiscoveryMetadataV1, signals: Signals): number {
  return metadata.requiredConceptGroups.filter((group) =>
    conceptsForGroup(metadata, group).some((concept) => signals[group].has(concept))
  ).length;
}

function anchorFor(metadata: ToolDiscoveryMetadataV1, signals: Signals): string {
  return metadata.resourceConcepts.find((concept) => signals.resource.has(concept)) ?? 'global';
}

function bindArguments(bindings: readonly ToolDiscoveryArgumentBindingV1[], input: ToolDiscoveryInput): Readonly<Record<string, unknown>> | undefined {
  const output: Record<string, unknown> = {};
  for (const binding of bindings) {
    let values: unknown[];
    if (binding.source === 'entity_value') values = input.entityCandidates.filter((entry) => entry.confidence >= 0.8 && binding.concepts.includes(entry.type)).map((entry) => entry.value);
    else if (binding.source === 'normalized_term') values = input.normalizedTerms.filter((entry) => entry.confidence >= 0.8 && binding.concepts.includes(entry.normalizedTerm)).map((entry) => entry.normalizedTerm);
    else values = input.timeRanges.filter((entry) => binding.concepts.includes(entry.label)).map((entry) => entry.label);
    const unique = [...new Set(values)];
    if (unique.length > 1) return undefined;
    if (unique.length === 1) output[binding.argumentName] = unique[0];
  }
  return Object.freeze(output);
}

function groupByAnchor(values: readonly ScoredCandidate[]): Map<string, ScoredCandidate[]> {
  const grouped = new Map<string, ScoredCandidate[]>();
  for (const value of values) grouped.set(value.anchor, [...(grouped.get(value.anchor) ?? []), value]);
  return grouped;
}

function empty(): ToolDiscoveryResult {
  return Object.freeze({ candidates: Object.freeze([]), taskType: 'general_lookup', requiredEvidence: Object.freeze([]), matchConfidence: 0, clarificationNeeds: Object.freeze([]), discoveredTaskTypes: Object.freeze([]) });
}

function blocked(metadata: ToolDiscoveryMetadataV1): ToolDiscoveryResult {
  return Object.freeze({
    candidates: Object.freeze([]), taskType: metadata.taskType, requiredEvidence: metadata.requiredEvidence,
    matchConfidence: 0, discoveredTaskTypes: Object.freeze([]),
    clarificationNeeds: Object.freeze([{ type: 'tool_arguments', reason: 'tool_arguments_missing_or_invalid', question: '請補充查詢所需的識別資料。', blocking: true }])
  });
}

function ambiguity(): ToolDiscoveryResult {
  return Object.freeze({
    candidates: Object.freeze([]), taskType: 'clarification_required', requiredEvidence: Object.freeze([]), matchConfidence: 0,
    clarificationNeeds: Object.freeze([{ type: 'tool', reason: 'tool_ambiguity', question: '找到多個可能的查詢工具，請補充要查詢的業務內容。', blocking: true }]),
    discoveredTaskTypes: Object.freeze([])
  });
}

function concepts(value: unknown, minimum = 0, maximum = 32): readonly string[] | undefined {
  const values = stringArray(value, minimum, maximum);
  return values && values.every(safeName) ? Object.freeze(values) : undefined;
}

function bindingConceptValues(source: unknown, value: unknown): readonly string[] | undefined {
  const values = stringArray(value, 1, 8);
  if (!values) return undefined;
  if (source === 'entity_value') {
    const allowed = new Set(['orderId', 'workOrderId', 'itemSku', 'customerId', 'supplierId']);
    return values.every((entry) => allowed.has(entry)) ? Object.freeze(values) : undefined;
  }
  return values.every(safeName) ? Object.freeze(values) : undefined;
}

function stringArray(value: unknown, minimum: number, maximum: number): string[] | undefined {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum || !value.every((entry) => typeof entry === 'string')) return undefined;
  const values = value as string[];
  return new Set(values).size === values.length ? [...values] : undefined;
}

function safeName(value: unknown): value is string {
  return typeof value === 'string' && SAFE_NAME.test(value) && !FORBIDDEN.test(value);
}

function safeArgumentName(value: unknown): value is string {
  if (typeof value !== 'string' || !SAFE_NAME.test(value)) return false;
  const normalized = value.toLowerCase().replace(/[-_.]/g, '');
  return ![
    'customerid', 'integrationid', 'hostapp', 'connectorkey', 'connectorinstanceid',
    'adapterkey', 'destination', 'endpoint', 'url', 'uri', 'path', 'method', 'httpmethod',
    'header', 'headers', 'authorization', 'credential', 'password', 'secret', 'token',
    'connectorcontextref', 'sql', 'command', 'callback', 'script'
  ].some((term) => normalized === term || normalized.includes(term));
}

function hasExactKeys(value: Record<string, unknown>, keys: Set<string>): boolean {
  return Object.keys(value).length === keys.size && Object.keys(value).every((key) => keys.has(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
