import { Inject, Injectable, Optional } from '@nestjs/common';
import { DefaultTokenizerAdapter } from './default-tokenizer.adapter';
import { generateClarificationNeeds } from './clarification-need.generator';
import { extractEntityCandidates } from './entity-extractor';
import { parseTimeRanges } from './time-range.parser';
import { mapExtractedPhrases, normalizeDomainTerms, toQueryTokens } from './query-normalizer';
import { QueryUnderstandingPipeline } from './query-understanding-pipeline.interface';
import { QueryUnderstandingInput, QueryUnderstandingOutput } from './query-understanding.types';
import { normalizeQueryText, splitQuerySentences } from './query-sentence-splitter';
import {
  decomposeSubTasks,
  inferRequiredEvidence,
  inferRiskLevel,
  isDocumentTaskType,
  inferTaskType
} from './query-task-decomposer';
import { resolveDeixisReferences } from './deixis-resolver';
import { scoreQueryUnderstandingConfidence } from './query-confidence.scorer';
import { TokenizerAdapter } from './tokenizer-adapter.interface';
import { CapabilityResolutionService } from '../capabilities/capability-resolution.service';
import { CapabilityCatalogRegistry } from '../capabilities/capability-catalog.registry';
import { CapabilityParameterResolverService } from '../capabilities/capability-parameter-resolver.service';
import type { CapabilityResolutionResultV1 } from '../capabilities/capability-pack.types';
import type { CapabilityFollowUpFrameV1 } from '../assistant/conversation/conversation.types';
import { createCustomerScopeFromHostIntegrationContext } from '../host-integration/host-integration-request.factory';
import { RiskLevel } from '../generated/prisma/enums';
import { ConversationSemanticReconstructorService } from '../assistant/conversation/conversation-semantic-reconstructor.service';
import { FollowUpSemanticResolverService } from '../assistant/conversation/follow-up-semantic-resolver.service';
import type { ConversationSemanticFrame, SemanticDimension } from '../assistant/conversation/conversation.types';

const DEPENDENT_FOLLOW_UP = /(呢|那個|你剛|剛才|剛剛|前面|同樣|再列一次|這個(?!月))/;
const VAGUE_DEIXIS = /^\s*那個(?:呢)?[？?。!！]?\s*$/;
const EXPLICIT_DOCUMENT_EVIDENCE_RECALL = /(引用的文件|文件證據)/i;

@Injectable()
export class RuleBasedQueryUnderstandingPipeline implements QueryUnderstandingPipeline {
  constructor(
    @Inject('TokenizerAdapter')
    private readonly tokenizerAdapter: TokenizerAdapter,
    private readonly capabilityResolution: CapabilityResolutionService,
    @Optional() private readonly semanticReconstructor = new ConversationSemanticReconstructorService(),
    @Optional() private readonly followUpResolver = new FollowUpSemanticResolverService(),
    @Optional() private readonly catalogRegistry?: CapabilityCatalogRegistry,
    @Optional() private readonly capabilityParameters?: CapabilityParameterResolverService
  ) {}

  async understand(input: QueryUnderstandingInput): Promise<QueryUnderstandingOutput> {
    const normalizedText = normalizeQueryText(input.text);
    const sentences = splitQuerySentences(normalizedText);
    const tokenResult = await this.tokenizerAdapter.tokenize({
      requestId: input.requestId,
      text: normalizedText,
      locale: 'zh-TW'
    });
    const phraseResult = await this.tokenizerAdapter.extractPhrases({
      requestId: input.requestId,
      text: normalizedText,
      locale: 'zh-TW'
    });
    const tokens = toQueryTokens(tokenResult.tokens, sentences);
    const phrases = mapExtractedPhrases(phraseResult.phrases, tokens, normalizedText);
    let normalizedTerms = normalizeDomainTerms(normalizedText, tokens);
    const timeRangeResult = parseTimeRanges(normalizedText, input.now ?? new Date(), input.timezone ?? 'Asia/Taipei');
    let entityCandidates = extractEntityCandidates(normalizedText, input.pageContext, input.assistantContextState);
    const resolvedReferences = resolveDeixisReferences(
      normalizedText,
      input.pageContext,
      input.assistantContextState
    );
    let semanticPhrases = phrases;
    let semanticTimeRanges = timeRangeResult.timeRanges;
    let currentSemanticFrame = this.semanticReconstructor.reconstruct({
      normalizedTerms, phrases, timeRanges: semanticTimeRanges, entityCandidates, resolvedReferences
    }, input.messageId);
    currentSemanticFrame = enrichInventoryAvailability(currentSemanticFrame, input.messageId);
    const dependentFollowUp = DEPENDENT_FOLLOW_UP.test(normalizedText) && !EXPLICIT_DOCUMENT_EVIDENCE_RECALL.test(normalizedText);
    const followUpResolution = dependentFollowUp
      ? this.followUpResolver.resolve({
          currentFrame: currentSemanticFrame,
          priorFrames: input.priorConversationContext?.semanticFrames ?? [],
          vagueReference: VAGUE_DEIXIS.test(normalizedText)
        })
      : undefined;
    const effectiveFrame = followUpResolution?.resolvedFrame ?? currentSemanticFrame;
    if (followUpResolution && followUpResolution.kind !== 'CLARIFY' && effectiveFrame) {
      normalizedTerms = mergeFrameTerms(normalizedTerms, effectiveFrame);
      semanticPhrases = mergeFramePhrases(semanticPhrases, effectiveFrame);
      semanticTimeRanges = mergeFrameTimeRanges(semanticTimeRanges, effectiveFrame, input.timezone ?? 'Asia/Taipei');
      entityCandidates = mergeFrameEntities(entityCandidates, effectiveFrame);
    }

    const riskLevel = inferRiskLevel(normalizedText);
    const resolvedDocumentTopic = effectiveFrame?.resource?.value === 'travelSubsidyPolicy';
    const documentTaskType = resolvedDocumentTopic ? 'policy_lookup' : inferTaskType(normalizedText);
    let independentlyDecomposedSubTasks = decomposeSubTasks(sentences);
    const hasStructuredResourceSignal = normalizedTerms.some((term) => term.category === 'resource' && ['inventory', 'stock', 'workOrder', 'order'].includes(term.normalizedTerm));
    if (independentlyDecomposedSubTasks.length === 1 && isDocumentTaskType(independentlyDecomposedSubTasks[0].type) && hasStructuredResourceSignal) {
      independentlyDecomposedSubTasks = [
        { type: 'general_lookup', text: independentlyDecomposedSubTasks[0].text },
        { type: independentlyDecomposedSubTasks[0].type, text: independentlyDecomposedSubTasks[0].text }
      ];
    }
    const hasDocumentSubTask = independentlyDecomposedSubTasks.some((subTask) => isDocumentTaskType(subTask.type));
    const hasNonDocumentSubTask = independentlyDecomposedSubTasks.some((subTask) => !isDocumentTaskType(subTask.type));
    const scope = Object.freeze({ customerId: input.hostIntegrationContext.customerId,
      integrationId: input.hostIntegrationContext.integrationId, hostApp: input.hostIntegrationContext.hostApp });
    const scoped = this.catalogRegistry?.resolveCatalog(scope);
    const catalog = scoped?.available ? scoped.catalog : undefined;
    const priorCapabilityFrame = dependentFollowUp && !VAGUE_DEIXIS.test(normalizedText) && catalog
      ? input.priorConversationContext?.capabilityFrames?.filter((frame) =>
        frame.scope.customerId === scope.customerId && frame.scope.integrationId === scope.integrationId &&
        frame.scope.hostApp === scope.hostApp && frame.packId === catalog.packId && frame.packVersion === catalog.packVersion &&
        catalog.capabilities.some((item) => item.active && item.capabilityKey === frame.capabilityKey)).at(-1)
      : undefined;
    const priorCapability = priorCapabilityFrame && catalog?.capabilities.find((entry) => entry.capabilityKey === priorCapabilityFrame.capabilityKey);
    const pageContextValues: Record<string, unknown> = {};
    if (catalog && this.capabilityParameters && input.pageContext?.entityId) {
      for (const capability of catalog.capabilities) {
        for (const parameter of capability.parameters) {
          if (parameter.type === 'bounded_string' &&
            this.capabilityParameters.validateCanonicalValue(parameter, input.pageContext.entityId) !== undefined) {
            pageContextValues[parameter.parameterName] = input.pageContext.entityId;
          }
        }
      }
    }
    const currentValues: Record<string, unknown> = {};
    if (priorCapability && this.capabilityParameters) {
      const singleBounded = priorCapability.parameters.length === 1 && priorCapability.parameters[0].type === 'bounded_string'
        ? priorCapability.parameters[0] : undefined;
      if (singleBounded && currentSemanticFrame?.entity?.value) currentValues[singleBounded.parameterName] = currentSemanticFrame.entity.value;
    }
    const provisionalParameters = priorCapability && this.capabilityParameters && priorCapabilityFrame
      ? this.capabilityParameters.resolve({ capability: priorCapability, text: normalizedText, currentValues,
        capabilityRef: { packId: catalog!.packId, packVersion: catalog!.packVersion,
          capabilityKey: priorCapability.capabilityKey, safeLabel: priorCapability.safeLabel } })
      : undefined;
    const provisionalFrame: CapabilityFollowUpFrameV1 | undefined = priorCapabilityFrame && provisionalParameters
      ? Object.freeze({ ...priorCapabilityFrame, sourceMessageId: input.messageId,
        parameters: Object.freeze(Object.entries(provisionalParameters.status === 'VALID' ? provisionalParameters.parameters : {})
          .map(([parameterName, value]) => Object.freeze({ parameterName, value, source: 'current_explicit' as const,
            sourceMessageId: input.messageId }))) })
      : undefined;
    const capabilityFollowUpResolution = provisionalFrame && catalog
      ? this.followUpResolver.resolveCapability({ currentFrame: provisionalFrame,
        priorFrames: [priorCapabilityFrame!], catalog })
      : undefined;
    const mustClarifyFollowUp = followUpResolution?.kind === 'CLARIFY' && !capabilityFollowUpResolution?.resolvedFrame;
    const capabilityResult: CapabilityResolutionResultV1 | undefined = (!hasNonDocumentSubTask && isDocumentTaskType(documentTaskType)) || riskLevel !== RiskLevel.low
      || mustClarifyFollowUp
      ? undefined
      : await this.capabilityResolution.resolve({
          scope,
          text: normalizedText,
          pageContextValues,
          ...(capabilityFollowUpResolution?.resolvedFrame ? { followUpFrame: capabilityFollowUpResolution.resolvedFrame } : {}),
          auditContext: {
            customerScope: createCustomerScopeFromHostIntegrationContext(input.hostIntegrationContext),
            requestId: input.requestId, sessionId: input.sessionId, messageId: input.messageId
          }
        });
    const candidateTools = capabilityResult?.outcome === 'RESOLVED' ? [capabilityResult.toolCandidate] : [];
    const currentCapabilityFrame: CapabilityFollowUpFrameV1 | undefined = capabilityResult &&
      (capabilityResult.outcome === 'RESOLVED' || capabilityResult.outcome === 'CAPABILITY_UNAVAILABLE')
      ? Object.freeze({ version: '1', scope, packId: capabilityResult.capability.packId,
        packVersion: capabilityResult.capability.packVersion, capabilityKey: capabilityResult.capability.capabilityKey,
        sourceMessageId: input.messageId,
        parameters: Object.freeze(Object.entries(capabilityResult.parameters).map(([parameterName, value]) =>
          Object.freeze({ parameterName, value, source: 'current_explicit' as const, sourceMessageId: input.messageId }))) })
      : undefined;
    const taskType = capabilityResult?.outcome === 'RESOLVED' ? 'general_lookup' : documentTaskType;
    const requiredEvidence = capabilityResult?.outcome === 'RESOLVED'
      ? ['identity_context', 'structured_record', ...(hasDocumentSubTask ? ['document_chunk'] : [])]
      : inferRequiredEvidence(taskType, entityCandidates, resolvedReferences);
    const subTasks = independentlyDecomposedSubTasks.length > 1
      ? independentlyDecomposedSubTasks
      : decomposeSubTasks(sentences, taskType);
    const followUpClarification = mustClarifyFollowUp ? [{
      type: 'follow_up', reason: followUpResolution.reasonCode, question: '請明確指定要查詢的主題或對象。', blocking: true
    }] : [];
    const capabilityClarification = capabilityResult?.outcome === 'NEEDS_CLARIFICATION' || capabilityResult?.outcome === 'AMBIGUOUS'
      ? [{ type: 'capability', reason: capabilityResult.reasonCode, question: '請補充要查詢的業務對象或條件。', blocking: true }]
      : [];
    const clarificationNeeds = [...followUpClarification, ...capabilityClarification, ...generateClarificationNeeds({
      text: normalizedText,
      timeClarifications: timeRangeResult.clarificationNeeds,
      entityCandidates,
      resolvedReferences,
      candidateTools,
      allowNoToolCandidate: isDocumentTaskType(taskType) || mustClarifyFollowUp || capabilityResult !== undefined
    })];
    const scoredConfidence = scoreQueryUnderstandingConfidence({
      text: normalizedText,
      entityCandidates,
      candidateTools,
      resolvedReferences,
      clarificationNeeds,
      hasDocumentEvidenceRequirement: requiredEvidence.includes('document_chunk')
      , discoveryConfidence: capabilityResult?.outcome === 'RESOLVED' ? 1 : undefined,
      hasResolvedSemanticFollowUp: followUpResolution !== undefined && followUpResolution.kind !== 'CLARIFY'
    });
    const confidence = capabilityResult?.outcome === 'RESOLVED' || capabilityResult?.outcome === 'CAPABILITY_UNAVAILABLE'
      ? Math.max(0.7, scoredConfidence)
      : EXPLICIT_DOCUMENT_EVIDENCE_RECALL.test(normalizedText)
      ? Math.max(0.7, scoredConfidence)
      : scoredConfidence;

    return {
      taskType,
      sentences,
      tokens,
      phrases: semanticPhrases,
      normalizedTerms,
      timeRanges: semanticTimeRanges,
      resolvedReferences,
      entityCandidates,
      subTasks,
      candidateTools,
      riskLevel,
      confidence,
      clarificationNeeds,
      requiredEvidence,
      currentSemanticFrame,
      followUpResolution,
      currentCapabilityFrame,
      capabilityFollowUpResolution,
      capabilityResolution: capabilityResult
    };
  }
}

function enrichInventoryAvailability(frame: ConversationSemanticFrame | undefined, messageId: string): ConversationSemanticFrame | undefined {
  if (!frame || frame.resource?.value !== 'inventory' || frame.metricOrAspect) return frame;
  return Object.freeze({ ...frame, metricOrAspect: dimension('availability', messageId), topicKey: buildTopicKey(frame) });
}

function mergeFrameTerms(current: QueryUnderstandingOutput['normalizedTerms'], frame: ConversationSemanticFrame) {
  const output = [...current];
  const add = (value: string | undefined, category: QueryUnderstandingOutput['normalizedTerms'][number]['category']) => {
    if (!value || output.some((entry) => entry.category === category && entry.normalizedTerm === value)) return;
    output.push({ originalTerm: value, normalizedTerm: value, category, confidence: 1, reason: 'resolved_follow_up_semantics' });
  };
  add(frame.resource?.value, 'resource');
  add(frame.intent?.value, 'operation');
  add(frame.metricOrAspect?.value, 'metric');
  add(frame.timeRange?.value, 'time');
  return output;
}

function mergeFramePhrases(current: QueryUnderstandingOutput['phrases'], frame: ConversationSemanticFrame) {
  const output = [...current];
  const add = (value: string | undefined, category: QueryUnderstandingOutput['phrases'][number]['category']) => {
    if (!value || output.some((entry) => entry.category === category && entry.normalizedValue === value)) return;
    output.push({ value, normalizedValue: value, category });
  };
  add(frame.resource?.value, 'resource');
  add(frame.intent?.value, 'intent');
  add(frame.metricOrAspect?.value, 'metric');
  add(frame.timeRange?.value, 'time');
  return output;
}

function mergeFrameTimeRanges(current: QueryUnderstandingOutput['timeRanges'], frame: ConversationSemanticFrame, timezone: string) {
  if (!frame.timeRange || current.some((entry) => entry.label === frame.timeRange?.value)) return current;
  return [...current, { label: frame.timeRange.value, start: '', end: '', timezone, source: 'resolved_follow_up_semantics', confidence: frame.timeRange.confidence }];
}

function mergeFrameEntities(current: QueryUnderstandingOutput['entityCandidates'], frame: ConversationSemanticFrame) {
  if (!frame.entity || current.some((entry) => entry.type === frame.entity?.entityType && entry.value === frame.entity?.value)) return current;
  const allowed = ['orderId', 'workOrderId', 'itemSku', 'customerId', 'supplierId', 'unknown'] as const;
  const type = allowed.includes(frame.entity.entityType as typeof allowed[number])
    ? frame.entity.entityType as typeof allowed[number]
    : 'unknown';
  return [...current, { type, value: frame.entity.value, confidence: frame.entity.confidence }];
}

function dimension(value: string, messageId: string): SemanticDimension {
  return Object.freeze({ value, sourceMessageId: messageId, source: 'current_explicit', confidence: 0.9 });
}

function buildTopicKey(frame: ConversationSemanticFrame): string | undefined {
  return [frame.resource?.value, frame.entity?.entityType, frame.entity?.value].filter(Boolean).join(':') || undefined;
}
