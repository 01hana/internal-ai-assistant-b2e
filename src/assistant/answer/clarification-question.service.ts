import { Injectable } from '@nestjs/common';
import { AuditWriterService } from '../../audit/audit-writer.service';
import { Prisma } from '../../generated/prisma/client';
import { ClarificationQuestionStatus } from '../../generated/prisma/enums';
import { RequestIdentityContext } from '../../identity/identity-context.types';
import { CustomerScope } from '../../identity/customer-scope.types';
import { PrismaService } from '../../prisma/prisma.service';

export interface CreateClarificationQuestionInput {
  customerScope: CustomerScope;
  requestId: string;
  sessionId: string;
  messageId: string;
  identityContext: RequestIdentityContext;
  question: string;
  reason: string;
  candidateRefs: unknown[];
  blocking: boolean;
  confidence?: number;
}

@Injectable()
export class ClarificationQuestionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditWriter: AuditWriterService
  ) {}

  async create(input: CreateClarificationQuestionInput) {
    const question = await this.prisma.db.clarificationQuestion.create({
      data: {
        customerId: input.customerScope.customerId,
        requestId: input.requestId,
        messageId: input.messageId,
        question: input.question,
        reason: input.reason,
        status: ClarificationQuestionStatus.pending,
        metadata: toJsonInput({
          reason: input.reason,
          candidateRefs: input.candidateRefs,
          blocking: input.blocking,
          confidence: input.confidence ?? null
        })
      }
    });

    await this.auditWriter.append({
      customerScope: input.customerScope,
      requestId: input.requestId,
      sessionId: input.sessionId,
      messageId: input.messageId,
      eventType: 'clarification_question_created',
      metadata: toJsonInput({
        clarificationQuestionId: question.id,
        reason: input.reason,
        candidateRefCount: input.candidateRefs.length,
        blocking: input.blocking
      })
    });

    return question;
  }
}

function toJsonInput<T>(value: T): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}
