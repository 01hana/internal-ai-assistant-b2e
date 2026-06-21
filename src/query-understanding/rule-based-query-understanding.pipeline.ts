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
  inferCandidateTools,
  inferRequiredEvidence,
  inferRiskLevel,
  inferTaskType
} from './query-task-decomposer';
import { resolveDeixisReferences } from './deixis-resolver';
import { scoreQueryUnderstandingConfidence } from './query-confidence.scorer';
import { TokenizerAdapter } from './tokenizer-adapter.interface';

@Injectable()
export class RuleBasedQueryUnderstandingPipeline implements QueryUnderstandingPipeline {
  constructor(
    @Optional()
    @Inject('TokenizerAdapter')
    private readonly tokenizerAdapter: TokenizerAdapter = new DefaultTokenizerAdapter()
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
    const normalizedTerms = normalizeDomainTerms(normalizedText, tokens);
    const timeRangeResult = parseTimeRanges(normalizedText, input.now ?? new Date(), input.timezone ?? 'Asia/Taipei');
    const entityCandidates = extractEntityCandidates(normalizedText, input.pageContext, input.assistantContextState);
    const resolvedReferences = resolveDeixisReferences(
      normalizedText,
      input.pageContext,
      input.assistantContextState
    );
    const candidateTools = inferCandidateTools(normalizedText, entityCandidates, normalizedTerms);
    const taskType = inferTaskType(normalizedText, candidateTools);
    const requiredEvidence = inferRequiredEvidence(taskType, entityCandidates, resolvedReferences);
    const riskLevel = inferRiskLevel(normalizedText);
    const subTasks = decomposeSubTasks(sentences, normalizedText, candidateTools);
    const clarificationNeeds = generateClarificationNeeds({
      text: normalizedText,
      timeClarifications: timeRangeResult.clarificationNeeds,
      entityCandidates,
      resolvedReferences,
      candidateTools
    });
    const confidence = scoreQueryUnderstandingConfidence({
      text: normalizedText,
      entityCandidates,
      candidateTools,
      resolvedReferences,
      clarificationNeeds
    });

    return {
      taskType,
      sentences,
      tokens,
      phrases,
      normalizedTerms,
      timeRanges: timeRangeResult.timeRanges,
      resolvedReferences,
      entityCandidates,
      subTasks,
      candidateTools,
      riskLevel,
      confidence,
      clarificationNeeds,
      requiredEvidence
    };
  }
}
