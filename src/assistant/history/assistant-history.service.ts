import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditWriterService } from '../../audit/audit-writer.service';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { createCustomerScopeFromIdentityContext } from '../../identity/customer-scope.factory';
import { AssistantMessageRepository } from '../message/assistant-message.repository';
import { AssistantHistoryAccessService } from './assistant-history-access.service';
import { mapAssistantHistoryMessage } from './assistant-history.mapper';
import { AssistantHistoryResult, ListAssistantMessagesInput } from './assistant-history.types';

@Injectable()
export class AssistantHistoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly historyAccessService: AssistantHistoryAccessService,
    private readonly messageRepository: AssistantMessageRepository,
    private readonly auditWriter: AuditWriterService
  ) {}

  async listMessages(input: ListAssistantMessagesInput): Promise<AssistantHistoryResult> {
    const session = await this.historyAccessService.ensureVisibleActiveSession(input);
    const customerScope = createCustomerScopeFromIdentityContext(input.identityContext);
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 50);
    if (input.cursor) {
      const cursorMessage = await this.messageRepository.getVisibleMessageForSession({
        customerScope,
        sessionId: session.id,
        messageId: input.cursor
      });
      if (!this.historyAccessService.isCompletedHistoryMessage(cursorMessage)) throw new NotFoundException();
    }
    const visibleMessages: Awaited<ReturnType<AssistantMessageRepository['findMessagesForSession']>> = [];
    let scanCursor = input.cursor;
    while (visibleMessages.length <= limit) {
      const batch = await this.messageRepository.findMessagesForSession({
        customerScope, sessionId: session.id, limit: 50, cursor: scanCursor
      });
      for (const message of batch) {
        if (this.historyAccessService.isCompletedHistoryMessage(message)) visibleMessages.push(message);
        if (visibleMessages.length > limit) break;
      }
      if (visibleMessages.length > limit || batch.length < 50) break;
      scanCursor = batch.at(-1)!.id;
    }
    const nextMessage = visibleMessages[limit];
    visibleMessages.splice(limit);

    const toolCalls = await this.prisma.db.toolCall.findMany({
      where: {
        customerId: customerScope.customerId,
        sessionId: session.id
      },
      orderBy: {
        createdAt: 'asc'
      }
    });
    const evidenceRefs = await this.prisma.db.evidenceRef.findMany({
      where: {
        customerId: customerScope.customerId,
        messageId: {
          in: visibleMessages.map((message) => message.id)
        }
      },
      orderBy: {
        timestamp: 'asc'
      }
    });

    await this.auditWriter.append({
      customerScope,
      requestId: input.requestId,
      sessionId: session.id,
      eventType: 'session_history_viewed',
      metadata: toJsonInput({
        limit,
        order: input.order ?? 'asc',
        cursorProvided: Boolean(input.cursor),
        returnedMessageCount: visibleMessages.length,
        nextCursorPresent: Boolean(nextMessage)
      })
    });

    return {
      sessionId: session.id,
      messages: visibleMessages.map((message) =>
        mapAssistantHistoryMessage(
          message,
          toolCalls.filter((toolCall) => toolCall.messageId === message.id),
          evidenceRefs.filter((evidenceRef) => evidenceRef.messageId === message.id),
          input.identityContext.actor.permissionScopes
        )
      ),
      nextCursor: nextMessage ? visibleMessages.at(-1)?.id ?? null : null
    };
  }
}

function toJsonInput<T>(value: T): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}
