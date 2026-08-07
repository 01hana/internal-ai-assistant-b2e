import { Injectable } from '@nestjs/common';
import { AuditWriterService } from '../../audit/audit-writer.service';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
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
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 50);
    const messages = await this.messageRepository.findMessagesForSession({
      sessionId: session.id,
      limit: limit + 1,
      cursor: input.cursor
    });
    const visibleMessages = messages.slice(0, limit);
    const nextMessage = messages[limit];

    const toolCalls = await this.prisma.db.toolCall.findMany({
      where: {
        sessionId: session.id
      },
      orderBy: {
        createdAt: 'asc'
      }
    });
    const evidenceRefs = await this.prisma.db.evidenceRef.findMany({
      where: {
        messageId: {
          in: visibleMessages.map((message) => message.id)
        }
      },
      orderBy: {
        timestamp: 'asc'
      }
    });

    await this.auditWriter.append({
      requestId: input.requestId,
      organizationId: input.identityContext.company.organizationId,
      hostApp: input.identityContext.hostApp.hostApp,
      actorId: input.identityContext.actor.actorId,
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
