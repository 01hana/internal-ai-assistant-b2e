import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { AnswerDecisionStatus, AssistantMessageRole } from '../../generated/prisma/enums';
import { PrismaService } from '../../prisma/prisma.service';
import { PageContextDto } from '../page-context/page-context.dto';
import { toPageContextPersistence } from '../page-context/page-context.mapper';

@Injectable()
export class AssistantMessageRepository {
  constructor(private readonly prisma: PrismaService) {}

  createUserMessage(input: { sessionId: string; requestId: string; content: string; pageContext?: PageContextDto }) {
    return this.prisma.db.assistantMessage.create({
      data: {
        sessionId: input.sessionId,
        requestId: input.requestId,
        role: AssistantMessageRole.user,
        content: input.content,
        pageContext: toPageContextPersistence(input.pageContext) ?? Prisma.JsonNull
      }
    });
  }

  createPendingAssistantMessage(input: { sessionId: string; requestId: string }) {
    return this.prisma.db.assistantMessage.create({
      data: {
        sessionId: input.sessionId,
        requestId: input.requestId,
        role: AssistantMessageRole.assistant,
        content: 'Pending answer.',
        answerDecision: AnswerDecisionStatus.no_answer
      }
    });
  }

  completeAssistantMessage(input: { messageId: string; content: string; answerDecision: AnswerDecisionStatus }) {
    return this.prisma.db.assistantMessage.update({
      where: {
        id: input.messageId
      },
      data: {
        content: input.content,
        answerDecision: input.answerDecision
      }
    });
  }

  findMessagesForSession(input: { sessionId: string; limit: number; cursor?: string }) {
    return this.prisma.db.assistantMessage.findMany({
      where: {
        sessionId: input.sessionId
      },
      ...(input.cursor
        ? {
            cursor: {
              id: input.cursor
            },
            skip: 1
          }
        : {}),
      orderBy: {
        createdAt: 'asc'
      },
      take: input.limit
    });
  }
}
