import { Injectable } from '@nestjs/common';
import { Prisma, QueryUnderstandingResult } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PersistedQueryUnderstandingResult, QueryUnderstandingOutput } from './query-understanding.types';

@Injectable()
export class QueryUnderstandingRepository {
  constructor(private readonly prisma: PrismaService) {}

  async save(input: {
    requestId: string;
    messageId: string;
    output: QueryUnderstandingOutput;
  }): Promise<PersistedQueryUnderstandingResult> {
    const result = await this.prisma.db.queryUnderstandingResult.upsert({
      where: {
        messageId: input.messageId
      },
      update: toQueryUnderstandingPersistence(input.requestId, input.messageId, input.output),
      create: toQueryUnderstandingPersistence(input.requestId, input.messageId, input.output)
    });

    return mapPersistedQueryUnderstandingResult(result);
  }
}

function toQueryUnderstandingPersistence(
  requestId: string,
  messageId: string,
  output: QueryUnderstandingOutput
) {
  return {
    requestId,
    messageId,
    sentences: toJsonInput(output.sentences),
    tokens: toJsonInput(output.tokens),
    phrases: toJsonInput(output.phrases),
    normalizedTerms: toJsonInput(output.normalizedTerms),
    timeRanges: output.timeRanges.length > 0 ? toJsonInput(output.timeRanges) : Prisma.JsonNull,
    resolvedReferences:
      output.resolvedReferences.length > 0 ? toJsonInput(output.resolvedReferences) : Prisma.JsonNull,
    entityCandidates: toJsonInput(output.entityCandidates),
    subTasks: output.subTasks.length > 0 ? toJsonInput(output.subTasks) : Prisma.JsonNull,
    confidence: output.confidence,
    clarificationNeeds: output.clarificationNeeds.length > 0 ? toJsonInput(output.clarificationNeeds) : Prisma.JsonNull
  };
}

function mapPersistedQueryUnderstandingResult(result: QueryUnderstandingResult): PersistedQueryUnderstandingResult {
  return {
    id: result.id,
    requestId: result.requestId,
    messageId: result.messageId,
    sentences: result.sentences,
    tokens: result.tokens,
    phrases: result.phrases,
    normalizedTerms: result.normalizedTerms,
    timeRanges: result.timeRanges,
    resolvedReferences: result.resolvedReferences,
    entityCandidates: result.entityCandidates,
    subTasks: result.subTasks,
    confidence: result.confidence,
    clarificationNeeds: result.clarificationNeeds,
    createdAt: result.createdAt
  };
}

function toJsonInput<T>(value: T): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}
