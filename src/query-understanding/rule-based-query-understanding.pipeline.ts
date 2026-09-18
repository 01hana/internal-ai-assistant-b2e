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
import { ToolDiscoveryService } from '../tools/tool-discovery.service';
import { RiskLevel } from '../generated/prisma/enums';
import { ConversationSemanticReconstructorService } from '../assistant/conversation/conversation-semantic-reconstructor.service';
import { FollowUpSemanticResolverService } from '../assistant/conversation/follow-up-semantic-resolver.service';
import type { ConversationSemanticFrame, SemanticDimension } from '../assistant/conversation/conversation.types';

const DEPENDENT_FOLLOW_UP = /(呢|那個|你剛|剛才|剛剛|前面|同樣|再列一次|這個(?!月))/;
const VAGUE_DEIXIS = /^\s*那個(?:呢)?[？?。!！]?\s*$/;

@Injectable()
export class RuleBasedQueryUnderstandingPipeline implements QueryUnderstandingPipeline {
  constructor(
    @Inject('TokenizerAdapter')
    private readonly tokenizerAdapter: TokenizerAdapter,
    private readonly toolDiscovery: ToolDiscoveryService,
    @Optional() private readonly semanticReconstructor = new ConversationSemanticReconstructorService(),
    @Optional() private readonly followUpResolver = new FollowUpSemanticResolverService()
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
    const dependentFollowUp = DEPENDENT_FOLLOW_UP.test(normalizedText);
    const followUpResolution = dependentFollowUp
      ? this.followUpResolver.resolve({
          currentFrame: currentSemanticFrame,
          priorFrames: input.priorConversationContext?.semanticFrames ?? [],
          vagueReference: VAGUE_DEIXIS.test(normalizedText),
          preferLatest: !VAGUE_DEIXIS.test(normalizedText)
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
    const mustClarifyFollowUp = followUpResolution?.kind === 'CLARIFY';
    const discovery = (!hasNonDocumentSubTask && isDocumentTaskType(documentTaskType)) || riskLevel !== RiskLevel.low
      || mustClarifyFollowUp
      ? undefined
      : await this.toolDiscovery.discover({
          customerScope: Object.freeze({ customerId: input.hostIntegrationContext.customerId }),
          normalizedTerms, phrases: semanticPhrases, timeRanges: semanticTimeRanges, entityCandidates
        });
    const candidateTools = [...(discovery?.candidates ?? [])];
    const taskType = discovery?.taskType ?? documentTaskType;
    const requiredEvidence = discovery?.requiredEvidence.length
      ? [...new Set([...discovery.requiredEvidence, ...(hasDocumentSubTask ? ['document_chunk'] : [])])]
      : inferRequiredEvidence(taskType, entityCandidates, resolvedReferences);
    const subTasks = independentlyDecomposedSubTasks.length > 1
      ? independentlyDecomposedSubTasks
      : discovery?.discoveredTaskTypes.length
      ? discovery.discoveredTaskTypes.map((type, index) => ({ type, text: sentences[index]?.text ?? normalizedText }))
      : decomposeSubTasks(sentences, taskType);
    const followUpClarification = mustClarifyFollowUp ? [{
      type: 'follow_up', reason: followUpResolution.reasonCode, question: '請明確指定要查詢的主題或對象。', blocking: true
    }] : [];
    const unsupportedLastMonth = followUpResolution?.resolvedFrame?.timeRange?.value === 'last_month'
      && !isDocumentTaskType(taskType) && candidateTools.length === 0;
    const capabilityClarification = unsupportedLastMonth ? [{
      type: 'time_range', reason: 'unsupported_time_range', question: '目前無法查詢上個月的這項資料，請指定其他支援的時間範圍。', blocking: true
    }] : [];
    const clarificationNeeds = [...followUpClarification, ...capabilityClarification, ...(discovery?.clarificationNeeds ?? []), ...generateClarificationNeeds({
      text: normalizedText,
      timeClarifications: timeRangeResult.clarificationNeeds,
      entityCandidates,
      resolvedReferences,
      candidateTools,
      allowNoToolCandidate: isDocumentTaskType(taskType) || mustClarifyFollowUp || unsupportedLastMonth
    })];
    const confidence = scoreQueryUnderstandingConfidence({
      text: normalizedText,
      entityCandidates,
      candidateTools,
      resolvedReferences,
      clarificationNeeds,
      hasDocumentEvidenceRequirement: requiredEvidence.includes('document_chunk')
      , discoveryConfidence: discovery?.matchConfidence,
      hasResolvedSemanticFollowUp: followUpResolution !== undefined && followUpResolution.kind !== 'CLARIFY'
    });

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
      followUpResolution
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
