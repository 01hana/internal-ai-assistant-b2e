import { Inject, Injectable } from '@nestjs/common';
import { AuditWriterService } from '../audit/audit-writer.service';
import { createRuntimeDecisionMetadata } from '../observability/observability-metadata.helper';
import { QueryUnderstandingPipeline } from './query-understanding-pipeline.interface';
import { QueryUnderstandingRepository } from './query-understanding.repository';
import {
  PersistedQueryUnderstandingResult,
  QueryUnderstandingInput,
  QueryUnderstandingOutput
} from './query-understanding.types';

@Injectable()
export class QueryUnderstandingService {
  constructor(
    @Inject('QueryUnderstandingPipeline') private readonly pipeline: QueryUnderstandingPipeline,
    private readonly repository: QueryUnderstandingRepository,
    private readonly auditWriter: AuditWriterService
  ) {}

  async understandAndPersist(input: QueryUnderstandingInput): Promise<{
    output: QueryUnderstandingOutput;
    persisted: PersistedQueryUnderstandingResult;
  }> {
    const startedAt = new Date();
    const output = await this.pipeline.understand(input);
    const persisted = await this.repository.save({
      requestId: input.requestId,
      messageId: input.messageId,
      output
    });

    await this.auditWriter.append({
      requestId: input.requestId,
      organizationId: input.identityContext.organization.organizationId,
      hostApp: input.identityContext.hostApp.hostApp,
      actorId: input.identityContext.actor.actorId,
      sessionId: input.sessionId,
      messageId: input.messageId,
      eventType: 'query_understanding_completed',
      metadata: toJsonInput({
        taskType: output.taskType,
        candidateTools: output.candidateTools,
        clarificationNeeds: output.clarificationNeeds,
        queryUnderstandingId: persisted.id,
        confidence: output.confidence,
        ...createRuntimeDecisionMetadata({
          durationMs: Math.max(0, Date.now() - startedAt.getTime())
        })
      })
    });

    return {
      output,
      persisted
    };
  }
}

function toJsonInput<T>(value: T) {
  return value as unknown as import('../generated/prisma/client').Prisma.InputJsonValue;
}
