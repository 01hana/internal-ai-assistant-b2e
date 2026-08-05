import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { AnswerDecisionStatus, AssistantMessageRole } from '../../generated/prisma/enums';
import { CustomerScope } from '../../identity/customer-scope.types';
import { PrismaService } from '../../prisma/prisma.service';
import { PageContextDto } from '../page-context/page-context.dto';
import { toPageContextPersistence } from '../page-context/page-context.mapper';

@Injectable()
export class AssistantMessageRepository {
  constructor(private readonly prisma: PrismaService) {}

  createUserMessage(input: {
    customerScope: CustomerScope;
    sessionId: string;
    requestId: string;
    content: string;
    pageContext?: PageContextDto;
  }) {
    return this.prisma.db.assistantMessage.create({
      data: {
        customerId: input.customerScope.customerId,
        sessionId: input.sessionId,
        requestId: input.requestId,
        role: AssistantMessageRole.user,
        content: input.content,
        pageContext: toPageContextPersistence(input.pageContext) ?? Prisma.JsonNull
      }
    });
  }

  createPendingAssistantMessage(input: { customerScope: CustomerScope; sessionId: string; requestId: string }) {
    return this.prisma.db.assistantMessage.create({
      data: {
        customerId: input.customerScope.customerId,
        sessionId: input.sessionId,
        requestId: input.requestId,
        role: AssistantMessageRole.assistant,
        content: 'Pending answer.',
        answerDecision: AnswerDecisionStatus.no_answer
      }
    });
  }

  async getVisibleMessage(input: { customerScope: CustomerScope; messageId: string }) {
    const message = await this.prisma.db.assistantMessage.findUnique({
      where: {
        customerId_id: {
          customerId: input.customerScope.customerId,
          id: input.messageId
        }
      }
    });

    if (!message) {
      throw this.createMessageNotFoundError();
    }

    return message;
  }

  async completeAssistantMessage(input: {
    customerScope: CustomerScope;
    messageId: string;
    content: string;
    answerDecision: AnswerDecisionStatus;
  }) {
    await this.getVisibleMessage(input);
    return this.prisma.db.assistantMessage.update({
      where: {
        customerId_id: {
          customerId: input.customerScope.customerId,
          id: input.messageId
        }
      },
      data: {
        content: input.content,
        answerDecision: input.answerDecision
      }
    });
  }

  async getVisibleMessageForSession(input: { customerScope: CustomerScope; sessionId: string; messageId: string }) {
    const message = await this.prisma.db.assistantMessage.findFirst({
      where: {
        customerId: input.customerScope.customerId,
        sessionId: input.sessionId,
        id: input.messageId
      }
    });

    if (!message) {
      throw this.createMessageNotFoundError();
    }

    return message;
  }

  findMessagesForSession(input: { customerScope: CustomerScope; sessionId: string; limit: number; cursor?: string }) {
    return this.prisma.db.assistantMessage.findMany({
      where: {
        customerId: input.customerScope.customerId,
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

  private createMessageNotFoundError() {
    return new NotFoundException({
      error: 'NOT_FOUND',
      message: 'Assistant message not found.'
    });
  }
}
