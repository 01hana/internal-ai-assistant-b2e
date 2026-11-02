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
import { LlmToolSelectionService } from './llm-tool-selection.service';
import { CapabilityCatalogRegistry } from '../capabilities/capability-catalog.registry';
import { CapabilityParameterResolverService, validateCapabilityCanonicalValue } from '../capabilities/capability-parameter-resolver.service';
import { extractExplicitPriorEvidenceRecall, hasPriorCapabilityTargetSignal, resolveFollowUpSemanticEvidence } from '../capabilities/follow-up-semantic-evidence';
import type { CapabilityResolutionResultV1 } from '../capabilities/capability-pack.types';
import type { BoundedConversationContext, CapabilityFollowUpFrameV1 } from '../assistant/conversation/conversation.types';
import { createCustomerScopeFromHostIntegrationContext } from '../host-integration/host-integration-request.factory';
import { RiskLevel } from '../generated/prisma/enums';
import { ConversationSemanticReconstructorService } from '../assistant/conversation/conversation-semantic-reconstructor.service';
import { FollowUpSemanticResolverService } from '../assistant/conversation/follow-up-semantic-resolver.service';
import type { ConversationSemanticFrame } from '../assistant/conversation/conversation.types';

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
    @Optional() private readonly capabilityParameters?: CapabilityParameterResolverService,
    @Optional() private readonly llmToolSelection?: LlmToolSelectionService
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
    const currentSemanticFrame = this.semanticReconstructor.reconstruct({
      normalizedTerms, phrases, timeRanges: semanticTimeRanges, entityCandidates, resolvedReferences
    }, input.messageId);
    const explicitRecall = extractExplicitPriorEvidenceRecall(normalizedText);
    const dependentFollowUp = DEPENDENT_FOLLOW_UP.test(normalizedText) && !EXPLICIT_DOCUMENT_EVIDENCE_RECALL.test(normalizedText);
    const priorFrames = input.priorConversationContext?.semanticFrames ?? [];
    const priorCapabilityFrames = input.priorConversationContext?.capabilityFrames ?? [];
    const latestCapabilityFrame = priorCapabilityFrames.at(-1);
    const recallFrames = explicitRecall && priorFrames.length > 1 &&
      priorFrames.length === priorCapabilityFrames.length && latestCapabilityFrame &&
      priorFrames.every((frame) => sameRecallTopic(frame, priorFrames.at(-1)!)) &&
      priorCapabilityFrames.every((frame) => frame.capabilityKey === latestCapabilityFrame.capabilityKey &&
        frame.packId === latestCapabilityFrame.packId && frame.packVersion === latestCapabilityFrame.packVersion &&
        frame.scope.customerId === latestCapabilityFrame.scope.customerId &&
        frame.scope.integrationId === latestCapabilityFrame.scope.integrationId &&
        frame.scope.hostApp === latestCapabilityFrame.scope.hostApp)
      ? [priorFrames.at(-1)!] : priorFrames;
    const followUpResolution = dependentFollowUp
      ? this.followUpResolver.resolve({
          currentFrame: currentSemanticFrame,
          priorFrames: recallFrames,
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
    const priorCapabilityFrame = dependentFollowUp && !VAGUE_DEIXIS.test(normalizedText) && catalog && followUpResolution?.kind !== 'NEW_TOPIC'
      ? input.priorConversationContext?.capabilityFrames?.filter((frame) =>
        frame.scope.customerId === scope.customerId && frame.scope.integrationId === scope.integrationId &&
        frame.scope.hostApp === scope.hostApp && frame.packId === catalog.packId && frame.packVersion === catalog.packVersion &&
        catalog.capabilities.some((item) => item.active && item.capabilityKey === frame.capabilityKey)).at(-1)
      : undefined;
    const priorCapability = priorCapabilityFrame && catalog?.capabilities.find((entry) => entry.capabilityKey === priorCapabilityFrame.capabilityKey);
    const priorExchange = explicitRecall ? input.priorConversationContext?.exchanges?.at(-1) : undefined;
    const priorScope = input.priorConversationContext?.scope;
    const priorScopeMatches = priorScope?.customerId === scope.customerId && priorScope?.hostApp === scope.hostApp &&
      priorScope.organizationId === input.hostIntegrationContext.organizationId &&
      priorScope.actorId === input.hostIntegrationContext.actorId &&
      priorScope.sessionId === input.sessionId;
    const verifiedPriorQuestions = dependentFollowUp && !explicitRecall && !VAGUE_DEIXIS.test(normalizedText) &&
      priorScopeMatches && priorCapabilityFrame && catalog
      ? verifiedToolQuestions(input.priorConversationContext!, priorCapabilityFrame, catalog.packId,
        catalog.packVersion, scope.integrationId, priorCapability?.parameters ?? [])
      : [];
    const recallScopeMatches = priorScopeMatches;
    const linkedEvidence = priorExchange?.evidenceRefIds.flatMap((id) => {
      const ref = input.priorConversationContext?.evidenceRefs.find((candidate) => candidate.id === id &&
        candidate.messageId === priorExchange.assistantMessageId);
      return ref ? [ref] : [];
    }) ?? [];
    const recallTargetVerified = Boolean(explicitRecall && priorCapability && priorCapabilityFrame && priorExchange &&
      recallScopeMatches && priorExchange.capabilityFrame?.sourceMessageId === priorCapabilityFrame.sourceMessageId &&
      priorExchange.userMessageId === priorCapabilityFrame.sourceMessageId &&
      followUpResolution?.kind === 'INHERIT' && timeRangeResult.timeRanges.length === 0 &&
      (!currentSemanticFrame?.entity || currentSemanticFrame.entity.value === priorExchange.semanticFrame?.entity?.value) &&
      (!currentSemanticFrame?.metricOrAspect || currentSemanticFrame.metricOrAspect.value === priorExchange.semanticFrame?.metricOrAspect?.value) &&
      hasPriorCapabilityTargetSignal(priorCapability, explicitRecall.toolTarget) &&
      linkedEvidence.filter((ref) => ref.sourceType === 'structured_record').length === 1 &&
      (explicitRecall.kind === 'TOOL'
        ? linkedEvidence.length === 1
        : linkedEvidence.length === 2 && linkedEvidence.filter((ref) => ref.sourceType === 'document_chunk').length === 1 &&
          Boolean(priorExchange.userText && explicitRecall.documentTarget &&
            priorExchange.userText.toLocaleLowerCase('en-US').includes(explicitRecall.documentTarget))));
    const followUpEvidence = explicitRecall && !recallTargetVerified
      ? { kind: 'CLARIFY' as const, reasonCode: 'FOLLOW_UP_TARGET_UNVERIFIED' as const }
      : priorCapability && catalog
      ? resolveFollowUpSemanticEvidence({ catalog, priorCapability,
        text: recallTargetVerified ? explicitRecall!.toolTarget : normalizedText,
        timeRanges: timeRangeResult.timeRanges,
        exactlyRepeatedMetricTerms: currentSemanticFrame?.metricOrAspect?.value &&
          input.priorConversationContext?.semanticFrames?.at(-1)?.metricOrAspect?.value === currentSemanticFrame.metricOrAspect.value
          ? normalizedTerms.filter((term) => term.category === 'metric' &&
              term.normalizedTerm === currentSemanticFrame.metricOrAspect?.value).map((term) => term.originalTerm) : [] }) : undefined;
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
    const provisionalParameters = followUpEvidence?.kind === 'REUSE' && priorCapability && this.capabilityParameters && priorCapabilityFrame
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
    const llmSelectionEnabled = process.env.ASSISTANT_LLM_TOOL_SELECTION_ENABLED === 'true';
    const llmCanResolveFollowUp = llmSelectionEnabled && verifiedPriorQuestions.length > 0 &&
      followUpResolution?.reasonCode !== 'CONTRADICTORY_CURRENT_FRAME';
    const mustClarifyFollowUp = !llmCanResolveFollowUp &&
      ((followUpResolution?.kind === 'CLARIFY' && !capabilityFollowUpResolution?.resolvedFrame)
        || followUpEvidence?.kind === 'CLARIFY');
    const capabilityResult: CapabilityResolutionResultV1 | undefined = (!hasNonDocumentSubTask && isDocumentTaskType(documentTaskType)) || riskLevel !== RiskLevel.low
      || mustClarifyFollowUp
      ? undefined
      : llmSelectionEnabled
      ? input.identityContext && this.llmToolSelection
        ? await this.llmToolSelection!.select({ text: normalizedText, requestId: input.requestId,
            sessionId: input.sessionId, messageId: input.messageId, host: input.hostIntegrationContext,
            identity: input.identityContext,
            ...(priorCapabilityFrame && priorScopeMatches ? { previous: {
              capabilityKey: priorCapabilityFrame.capabilityKey,
              parameters: Object.fromEntries(priorCapabilityFrame.parameters.map((entry) =>
                [entry.parameterName, entry.value])),
              ...(verifiedPriorQuestions.length > 0 ? { recentQuestions: verifiedPriorQuestions } : {})
            } } : {}) })
        : { version: '1', outcome: 'NEEDS_CLARIFICATION', reasonCode: 'CAPABILITY_NOT_RECOGNIZED',
            missingParameters: [], invalidParameters: [], conflictingParameters: [] }
      : await this.capabilityResolution.resolve({
          scope,
          text: followUpEvidence?.kind === 'SWITCH' ? followUpEvidence.semanticText : normalizedText,
          ...(followUpEvidence?.kind === 'SWITCH' && priorCapabilityFrame
            ? { inheritedValues: Object.fromEntries(priorCapabilityFrame.parameters.flatMap((entry) => {
                const targetParameter = followUpEvidence.capability.parameters.find((parameter) => parameter.parameterName === entry.parameterName);
                return targetParameter && validateCapabilityCanonicalValue(targetParameter, entry.value) !== undefined
                  ? [[entry.parameterName, entry.value]] : [];
              })) } : {}),
          pageContextValues,
          ...(capabilityFollowUpResolution?.resolvedFrame ? { followUpFrame: capabilityFollowUpResolution.resolvedFrame } : {}),
          auditContext: {
            customerScope: createCustomerScopeFromHostIntegrationContext(input.hostIntegrationContext),
            requestId: input.requestId, sessionId: input.sessionId, messageId: input.messageId
          }
        });
    const candidateTools = capabilityResult?.outcome === 'RESOLVED' ? [capabilityResult.toolCandidate] : [];
    const preCandidateScopeApplicability = followUpEvidence?.kind === 'CLARIFY' && candidateTools.length === 0
      ? this.capabilityResolution.resolvePreCandidateScopeApplicability({ scope, text: normalizedText,
        sourceMessageId: input.messageId }) : undefined;
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
      type: 'follow_up', reason: followUpEvidence?.kind === 'CLARIFY' ? followUpEvidence.reasonCode : followUpResolution!.reasonCode,
      question: '請明確指定要查詢的主題或對象。', blocking: true
    }] : [];
    const capabilityClarification = (capabilityResult?.outcome === 'NEEDS_CLARIFICATION' &&
      !['LLM_NO_MATCH', 'LLM_NO_ALLOWED_TOOL', 'LLM_SELECTION_FAILED'].includes(capabilityResult.reasonCode)) ||
      capabilityResult?.outcome === 'AMBIGUOUS'
      ? [{ type: 'capability', reason: capabilityResult.reasonCode,
          question: capabilityResult.reasonCode === 'PARAMETER_ISSUES' ? '請補充查詢所需的識別資訊。' : '請補充要查詢的業務對象或條件。', blocking: true }]
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
      capabilityResolution: capabilityResult,
      preCandidateScopeApplicability
    };
  }
}

function sameRecallTopic(left: ConversationSemanticFrame, right: ConversationSemanticFrame): boolean {
  return left.resource?.value === right.resource?.value &&
    left.metricOrAspect?.value === right.metricOrAspect?.value &&
    left.timeRange?.value === right.timeRange?.value &&
    left.entity?.entityType === right.entity?.entityType &&
    left.entity?.value === right.entity?.value;
}

/** Only completed, grounded exchanges from the current capability chain may inform tool selection. */
function verifiedToolQuestions(context: BoundedConversationContext, latest: CapabilityFollowUpFrameV1,
  packId: string, packVersion: string, integrationId: string,
  parameters: readonly Readonly<{ parameterName: string; type: string }>[] = []): readonly string[] {
  const questions: string[] = [];
  const answered = new Set((context.completedAssistantAnswers ?? []).map((item) => item.exchangeId));
  for (const exchange of [...context.exchanges].reverse().slice(0, 3)) {
    const frame = exchange.capabilityFrame;
    const linked = exchange.evidenceRefIds.some((id) => context.evidenceRefs.some((ref) =>
      ref.id === id && ref.messageId === exchange.assistantMessageId && ref.sourceType === 'structured_record'));
    if (!frame || !answered.has(exchange.exchangeId) || !exchange.groundingVerified ||
      !exchange.selectionPreviouslyModelCalled || !linked ||
      frame.sourceMessageId !== exchange.userMessageId || frame.packId !== packId || frame.packVersion !== packVersion ||
      frame.capabilityKey !== latest.capabilityKey || frame.scope.customerId !== context.scope.customerId ||
      frame.scope.hostApp !== context.scope.hostApp || frame.scope.integrationId !== integrationId ||
      frame.parameters.some((parameter) => !parameters.some((definition) =>
        definition.parameterName === parameter.parameterName)) ||
      frame.parameters.some((parameter) => parameters.some((definition) =>
        definition.parameterName === parameter.parameterName && definition.type === 'bounded_string') &&
        !latest.parameters.some((item) => item.parameterName === parameter.parameterName && item.value === parameter.value)) ||
      !exchange.userText || exchange.userText.length > 512 ||
      /Bearer\s+\S+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|(?:sk|pk|api|secret|token)_[A-Za-z0-9_-]{8,}/i.test(exchange.userText)) break;
    questions.push(exchange.userText);
  }
  return Object.freeze(questions.reverse());
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
