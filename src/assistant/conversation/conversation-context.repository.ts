import { Injectable } from '@nestjs/common';
import { AssistantMessageRole, AssistantSessionStatus } from '../../generated/prisma/enums';
import { PrismaService } from '../../prisma/prisma.service';
import { MAX_CONTEXT_MESSAGE_SCAN } from './conversation-limits';
import { ConversationScope } from './conversation.types';

export interface ConversationContextRepositoryInput {
  readonly scope: ConversationScope;
}

@Injectable()
export class ConversationContextRepository {
  constructor(private readonly prisma: PrismaService) {}

  async loadScopedContext(input: ConversationContextRepositoryInput): Promise<readonly Record<string, unknown>[]> {
    const { scope } = input;
    const session = await this.prisma.db.assistantSession.findFirst({
      where: {
        customerId: scope.customerId,
        id: scope.sessionId,
        organizationId: scope.organizationId,
        hostApp: scope.hostApp,
        actorId: scope.actorId,
        status: AssistantSessionStatus.active
      }
    });
    if (!session) return [];

    const messages = await this.prisma.db.assistantMessage.findMany({
      where: {
        customerId: scope.customerId,
        sessionId: scope.sessionId
      },
      orderBy: { createdAt: 'desc' },
      take: MAX_CONTEXT_MESSAGE_SCAN,
      include: {
        queryUnderstanding: true,
        answerDecisions: { orderBy: { createdAt: 'desc' }, take: 1 },
        groundingChecks: { orderBy: { createdAt: 'desc' }, take: 1 },
        evidenceRefs: { orderBy: { timestamp: 'desc' } }
      }
    });

    const byRequest = new Map<string, { user?: MessageWithContext; assistant?: MessageWithContext }>();
    for (const rawMessage of messages) {
      const message = rawMessage as unknown as MessageWithContext;
      const pair = byRequest.get(message.requestId) ?? {};
      if (message.role === AssistantMessageRole.user && !pair.user) pair.user = message;
      if (message.role === AssistantMessageRole.assistant && !pair.assistant) pair.assistant = message;
      byRequest.set(message.requestId, pair);
    }

    return [...byRequest.entries()].flatMap(([requestId, pair]) => {
      if (!pair.user || !pair.assistant || (pair.assistant.answerDecisions ?? []).length === 0) return [];
      const decision = pair.assistant.answerDecisions![0];
      return [{
        exchangeId: requestId,
        requestId,
        scope,
        sessionStatus: session.status,
        completed: true,
        userMessage: {
          id: pair.user.id,
          content: pair.user.content,
          createdAt: pair.user.createdAt.toISOString()
        },
        assistantMessage: {
          id: pair.assistant.id,
          createdAt: pair.assistant.createdAt.toISOString()
        },
        answerDecision: {
          id: decision.id,
          status: decision.status
        },
        groundingCheck: pair.assistant.groundingChecks?.[0]
          ? {
              covered: pair.assistant.groundingChecks[0].covered,
              unsupportedClaimCount: pair.assistant.groundingChecks[0].unsupportedClaimCount
            }
          : undefined,
        queryUnderstanding: toSafeQueryUnderstandingSource(pair.user.queryUnderstanding),
        evidence: (pair.assistant.evidenceRefs ?? []).map((evidence) => ({
          id: evidence.id,
          messageId: evidence.messageId ?? undefined,
          sourceType: evidence.sourceType,
          sourceId: evidence.sourceId,
          timestamp: evidence.timestamp.toISOString(),
          summary: evidence.summary
        })),
        createdAt: pair.assistant.createdAt.toISOString()
      }];
    });
  }
}

function toSafeQueryUnderstandingSource(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  return {
    phrases: record.phrases,
    normalizedTerms: record.normalizedTerms,
    timeRanges: record.timeRanges,
    resolvedReferences: record.resolvedReferences,
    entityCandidates: record.entityCandidates,
    subTasks: record.subTasks,
    confidence: record.confidence
  };
}

interface MessageWithContext {
  readonly id: string;
  readonly requestId: string;
  readonly role: AssistantMessageRole;
  readonly content: string;
  readonly createdAt: Date;
  readonly queryUnderstanding?: unknown;
  readonly answerDecisions?: ReadonlyArray<{ readonly id: string; readonly status: string }>;
  readonly groundingChecks?: ReadonlyArray<{
    readonly covered: boolean;
    readonly unsupportedClaimCount: number;
  }>;
  readonly evidenceRefs?: ReadonlyArray<{
    readonly id: string;
    readonly messageId: string | null;
    readonly sourceType: string;
    readonly sourceId: string;
    readonly timestamp: Date;
    readonly summary: unknown;
  }>;
}
