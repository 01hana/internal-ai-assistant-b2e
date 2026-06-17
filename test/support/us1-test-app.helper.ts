import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  AssistantMessageRole,
  AssistantSessionStatus,
  AssistantTaskState,
  EvidenceSourceType,
  ExecutionDecision,
  RiskLevel,
  ToolCallStatus,
  ToolExecutionStatus,
  ToolOperation
} from '../../src/generated/prisma/enums';
import { GlobalExceptionFilter } from '../../src/common/errors/global-exception.filter';
import { RequestIdInterceptor } from '../../src/common/request-id/request-id.interceptor';
import { ResponseEnvelopeInterceptor } from '../../src/common/response/response-envelope.interceptor';

type SessionRecord = {
  id: string;
  hostApp: string;
  organizationId: string;
  actorId: string;
  status: AssistantSessionStatus;
  createdAt: Date;
  updatedAt: Date;
  lastMessageAt: Date | null;
};

type ContextStateRecord = {
  id: string;
  sessionId: string;
  currentTask: string | null;
  currentModule: string | null;
  currentPage: unknown;
  currentEntityType: string | null;
  currentEntityId: string | null;
  lastIntent: string | null;
  lastEntities: unknown;
  lastToolCallIds: string[];
  lastEvidenceRefIds: string[];
  pendingClarification: unknown;
  pendingApprovalRequestId: string | null;
  taskState: AssistantTaskState;
  createdAt: Date;
  updatedAt: Date;
};

type MessageRecord = {
  id: string;
  sessionId: string;
  requestId: string;
  role: AssistantMessageRole;
  content: string;
  answerDecision: string | null;
  pageContext: unknown;
  createdAt: Date;
};

type ToolCallRecord = {
  id: string;
  requestId: string;
  sessionId: string;
  messageId: string | null;
  toolName: string;
  toolVersion: string;
  inputSummary: unknown;
  permissionResult: unknown;
  outputSummary: unknown;
  status: ToolCallStatus;
  executionStatus: ToolExecutionStatus;
  durationMs: number | null;
  errorCode: string | null;
  createdAt: Date;
  executedAt: Date | null;
};

type ToolDefinitionRecord = {
  id: string;
  name: string;
  version: string;
  description: string;
  resource: string;
  operation: ToolOperation;
  inputSchema: unknown;
  outputSchema: unknown;
  requiredPermissions: string[];
  riskLevel: RiskLevel;
  hasSideEffect: boolean;
  requiresConfirmation: boolean;
  requiresApproval: boolean;
  connectorKey: string;
  timeoutMs: number;
  auditBehavior: unknown;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

type EvidenceRefRecord = {
  id: string;
  requestId: string | null;
  messageId: string | null;
  sourceType: EvidenceSourceType;
  sourceId: string;
  toolCallId: string | null;
  documentId: string | null;
  chunkId: string | null;
  entityType: string | null;
  entityId: string | null;
  fieldPaths: string[];
  timestamp: Date;
  permissionSnapshot: unknown;
  summary: unknown;
};

type AuditEventRecord = {
  id: string;
  requestId: string;
  timestamp: Date;
  organizationId: string;
  hostApp: string;
  actorId: string;
  sessionId: string | null;
  messageId: string | null;
  eventType: string;
  decision: string | null;
  toolCallId: string | null;
  riskLevel: RiskLevel | null;
  permissionResult: unknown;
  evidenceRefIds: string[];
  durationMs: number | null;
  metadata: unknown;
};

type QueryUnderstandingRecord = {
  id: string;
  requestId: string;
  messageId: string;
  sentences: unknown;
  tokens: unknown;
  phrases: unknown;
  normalizedTerms: unknown;
  timeRanges: unknown;
  resolvedReferences: unknown;
  entityCandidates: unknown;
  subTasks: unknown;
  confidence: number;
  clarificationNeeds: unknown;
  createdAt: Date;
};

type GroundingCheckRecord = {
  id: string;
  requestId: string;
  messageId: string;
  covered: boolean;
  checkedClaimCount: number;
  unsupportedClaimCount: number;
  evidenceRefIds: string[];
  metadata: unknown;
  createdAt: Date;
};

type AnswerDecisionRecord = {
  id: string;
  requestId: string;
  messageId: string;
  status: string;
  noAnswerReason: string | null;
  clarificationQuestionId: string | null;
  groundingCheckId: string | null;
  metadata: unknown;
  createdAt: Date;
};

type ExecutionPlanRecord = {
  id: string;
  sessionId: string;
  messageId: string | null;
  taskType: string;
  requiredEvidence: unknown;
  candidateTools: unknown;
  permissionChecks: unknown;
  riskAssessment: RiskLevel;
  clarificationNeeds: unknown;
  expectedAnswerShape: unknown;
  requiresMultiStepToolUse: boolean;
  decision: ExecutionDecision;
  createdAt: Date;
};

type MockState = {
  sessions: SessionRecord[];
  contextStates: ContextStateRecord[];
  messages: MessageRecord[];
  toolDefinitions: ToolDefinitionRecord[];
  toolCalls: ToolCallRecord[];
  evidenceRefs: EvidenceRefRecord[];
  auditEvents: AuditEventRecord[];
  queryUnderstandingResults: QueryUnderstandingRecord[];
  executionPlans: ExecutionPlanRecord[];
  groundingChecks: GroundingCheckRecord[];
  answerDecisions: AnswerDecisionRecord[];
};

export type Us1TestState = MockState;

export async function createUs1TestAppWithState(): Promise<{ app: INestApplication; state: Us1TestState }> {
  process.env.DATABASE_URL = 'postgresql://assistant:assistant_dev_password@localhost:5432/assistant_dev';
  process.env.POSTGRES_USER = 'assistant';
  process.env.POSTGRES_PASSWORD = 'assistant_dev_password';
  process.env.POSTGRES_DB = 'assistant_dev';
  process.env.LLM_PROVIDER = 'openai';
  process.env.LLM_MODEL = 'local-placeholder-model';
  process.env.OPENAI_API_KEY = 'placeholder-openai-api-key';
  process.env.ENABLE_SWAGGER_DOCS = 'false';
  process.env.SWAGGER_PATH = 'docs';

  const state = createInitialState();
  const prismaMock = createPrismaMock(state);

  const { AppModule } = await import('../../src/app.module');
  const { PrismaService } = await import('../../src/prisma/prisma.service');
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule]
  })
    .overrideProvider(PrismaService)
    .useValue({
      onModuleInit: jest.fn(),
      onModuleDestroy: jest.fn(),
      db: prismaMock
    })
    .compile();

  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ forbidNonWhitelisted: true, transform: true, whitelist: true }));
  app.useGlobalInterceptors(new RequestIdInterceptor(), new ResponseEnvelopeInterceptor());
  app.useGlobalFilters(new GlobalExceptionFilter());
  await app.init();

  return { app, state };
}

export async function createUs1TestApp(): Promise<INestApplication> {
  const { app } = await createUs1TestAppWithState();
  return app;
}

export function createIdentityHeaders(overrides?: Partial<Record<string, string>>) {
  return {
    'x-request-id': 'req-us1-default',
    'x-actor-id': 'actor-001',
    'x-host-app': 'erp',
    'x-organization-id': 'org-001',
    'x-role': 'planner',
    'x-permission-scopes': 'orders:read,inventory:read',
    ...overrides
  };
}

export function parseSseResponse(text: string) {
  const chunks = text
    .split('\n\n')
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  return chunks.map((chunk) => {
    const eventMatch = chunk.match(/^event:\s*(.+)$/m);
    const dataMatch = chunk.match(/^data:\s*(.+)$/m);

    return {
      event: eventMatch?.[1],
      data: dataMatch ? JSON.parse(dataMatch[1]) : undefined
    };
  });
}

function createPrismaMock(state: MockState) {
  return {
    assistantSession: {
      create: jest.fn(async ({ data }: { data: Partial<SessionRecord> }) => {
        const now = nextDate();
        const record: SessionRecord = {
          id: `session-created-${state.sessions.length + 1}`,
          hostApp: data.hostApp ?? 'erp',
          organizationId: data.organizationId ?? 'org-001',
          actorId: data.actorId ?? 'actor-001',
          status: (data.status as AssistantSessionStatus) ?? AssistantSessionStatus.active,
          createdAt: now,
          updatedAt: now,
          lastMessageAt: null
        };
        state.sessions.push(record);
        return record;
      }),
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => state.sessions.find((item) => item.id === where.id) ?? null),
      findFirst: jest.fn(
        async ({
          where
        }: {
          where: {
            id: string;
            organizationId: string;
            hostApp: string;
            actorId: string;
          };
        }) =>
          state.sessions.find(
            (item) =>
              item.id === where.id &&
              item.organizationId === where.organizationId &&
              item.hostApp === where.hostApp &&
              item.actorId === where.actorId
          ) ?? null
      )
    },
    toolDefinition: {
      findMany: jest.fn(
        async ({
          orderBy
        }: {
          orderBy?: Array<{ name?: 'asc' | 'desc'; version?: 'asc' | 'desc' }>;
        } = {}) => {
          const tools = [...state.toolDefinitions];
          if (orderBy?.length) {
            tools.sort((left, right) => {
              for (const order of orderBy) {
                if (order.name) {
                  const comparison = left.name.localeCompare(right.name);
                  if (comparison !== 0) {
                    return order.name === 'asc' ? comparison : -comparison;
                  }
                }
                if (order.version) {
                  const comparison = left.version.localeCompare(right.version);
                  if (comparison !== 0) {
                    return order.version === 'asc' ? comparison : -comparison;
                  }
                }
              }
              return 0;
            });
          }
          return tools;
        }
      ),
      findFirst: jest.fn(
        async ({
          where,
          orderBy
        }: {
          where: { name?: string };
          orderBy?: { updatedAt?: 'asc' | 'desc' };
        }) => {
          const tools = state.toolDefinitions.filter((item) => !where.name || item.name === where.name);
          return tools.sort((left, right) =>
            (orderBy?.updatedAt ?? 'desc') === 'desc'
              ? right.updatedAt.getTime() - left.updatedAt.getTime()
              : left.updatedAt.getTime() - right.updatedAt.getTime()
          )[0] ?? null;
        }
      )
    },
    assistantContextState: {
      create: jest.fn(async ({ data }: { data: Partial<ContextStateRecord> }) => {
        const now = nextDate();
        const record: ContextStateRecord = {
          id: `context-${state.contextStates.length + 1}`,
          sessionId: data.sessionId ?? 'session-owned-001',
          currentTask: (data.currentTask as string | null | undefined) ?? null,
          currentModule: (data.currentModule as string | null | undefined) ?? null,
          currentPage: data.currentPage ?? null,
          currentEntityType: (data.currentEntityType as string | null | undefined) ?? null,
          currentEntityId: (data.currentEntityId as string | null | undefined) ?? null,
          lastIntent: (data.lastIntent as string | null | undefined) ?? null,
          lastEntities: data.lastEntities ?? null,
          lastToolCallIds: (data.lastToolCallIds as string[] | undefined) ?? [],
          lastEvidenceRefIds: (data.lastEvidenceRefIds as string[] | undefined) ?? [],
          pendingClarification: data.pendingClarification ?? null,
          pendingApprovalRequestId: (data.pendingApprovalRequestId as string | null | undefined) ?? null,
          taskState: (data.taskState as AssistantTaskState) ?? AssistantTaskState.idle,
          createdAt: now,
          updatedAt: now
        };
        state.contextStates.push(record);
        return record;
      }),
      findFirst: jest.fn(
        async ({
          where
        }: {
          where: { sessionId: string };
          orderBy?: { updatedAt: 'desc' | 'asc' };
        }) =>
          [...state.contextStates]
            .filter((item) => item.sessionId === where.sessionId)
            .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())[0] ?? null
      ),
      upsert: jest.fn(async ({ where, create, update }: { where: { sessionId?: string }; create: Partial<ContextStateRecord>; update: Partial<ContextStateRecord> }) => {
        const key = where.sessionId ?? create.sessionId;
        const existing = state.contextStates.find((item) => item.sessionId === key);
        if (existing) {
          Object.assign(existing, update, { updatedAt: nextDate() });
          return existing;
        }

        const record = {
          id: `context-${state.contextStates.length + 1}`,
          sessionId: create.sessionId ?? key ?? 'session-owned-001',
          currentTask: (create.currentTask as string | null | undefined) ?? null,
          currentModule: (create.currentModule as string | null | undefined) ?? null,
          currentPage: create.currentPage ?? null,
          currentEntityType: (create.currentEntityType as string | null | undefined) ?? null,
          currentEntityId: (create.currentEntityId as string | null | undefined) ?? null,
          lastIntent: (create.lastIntent as string | null | undefined) ?? null,
          lastEntities: create.lastEntities ?? null,
          lastToolCallIds: (create.lastToolCallIds as string[] | undefined) ?? [],
          lastEvidenceRefIds: (create.lastEvidenceRefIds as string[] | undefined) ?? [],
          pendingClarification: create.pendingClarification ?? null,
          pendingApprovalRequestId: (create.pendingApprovalRequestId as string | null | undefined) ?? null,
          taskState: (create.taskState as AssistantTaskState) ?? AssistantTaskState.idle,
          createdAt: nextDate(),
          updatedAt: nextDate()
        };
        state.contextStates.push(record);
        return record;
      }),
      updateMany: jest.fn(async ({ where, data }: { where: { sessionId: string }; data: Partial<ContextStateRecord> }) => {
        const matching = state.contextStates.filter((item) => item.sessionId === where.sessionId);
        matching.forEach((item) => Object.assign(item, data, { updatedAt: nextDate() }));
        return {
          count: matching.length
        };
      })
    },
    assistantMessage: {
      create: jest.fn(async ({ data }: { data: Partial<MessageRecord> }) => {
        const now = nextDate();
        const record: MessageRecord = {
          id: `message-${state.messages.length + 1}`,
          sessionId: data.sessionId ?? 'session-owned-001',
          requestId: data.requestId ?? 'req-generated',
          role: (data.role as AssistantMessageRole) ?? AssistantMessageRole.user,
          content: data.content ?? '',
          answerDecision: (data.answerDecision as string | null | undefined) ?? null,
          pageContext: data.pageContext ?? null,
          createdAt: now
        };
        state.messages.push(record);
        const session = state.sessions.find((item) => item.id === record.sessionId);
        if (session) {
          session.lastMessageAt = now;
          session.updatedAt = now;
        }
        return record;
      }),
      findMany: jest.fn(
        async ({
          where,
          orderBy,
          take,
          cursor,
          skip
        }: {
          where: { sessionId: string };
          orderBy?: { createdAt: 'asc' | 'desc' };
          take?: number;
          cursor?: { id: string };
          skip?: number;
        }) => {
        const sorted = [...state.messages]
          .filter((item) => item.sessionId === where.sessionId)
          .sort((left, right) =>
            (orderBy?.createdAt ?? 'asc') === 'asc'
              ? left.createdAt.getTime() - right.createdAt.getTime()
              : right.createdAt.getTime() - left.createdAt.getTime()
          );
        const cursorIndex = cursor ? sorted.findIndex((item) => item.id === cursor.id) : -1;
        const startIndex = cursor ? Math.max(0, cursorIndex + (skip ?? 0)) : 0;
        const paginated = sorted.slice(startIndex);
        return typeof take === 'number' ? paginated.slice(0, take) : paginated;
      }),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<MessageRecord> }) => {
        const message = state.messages.find((item) => item.id === where.id);
        if (!message) {
          throw new Error(`Message ${where.id} not found.`);
        }

        Object.assign(message, data);
        return message;
      })
    },
    queryUnderstandingResult: {
      upsert: jest.fn(async ({ where, create, update }: { where: { messageId: string }; create: Partial<QueryUnderstandingRecord>; update: Partial<QueryUnderstandingRecord> }) => {
        const existing = state.queryUnderstandingResults.find((item) => item.messageId === where.messageId);
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }

        const record: QueryUnderstandingRecord = {
          id: `qu-${state.queryUnderstandingResults.length + 1}`,
          requestId: create.requestId ?? 'req-generated',
          messageId: create.messageId ?? where.messageId,
          sentences: create.sentences ?? [],
          tokens: create.tokens ?? [],
          phrases: create.phrases ?? [],
          normalizedTerms: create.normalizedTerms ?? [],
          timeRanges: create.timeRanges ?? null,
          resolvedReferences: create.resolvedReferences ?? null,
          entityCandidates: create.entityCandidates ?? [],
          subTasks: create.subTasks ?? null,
          confidence: create.confidence ?? 0,
          clarificationNeeds: create.clarificationNeeds ?? null,
          createdAt: nextDate()
        };
        state.queryUnderstandingResults.push(record);
        return record;
      })
    },
    executionPlan: {
      create: jest.fn(async ({ data }: { data: Partial<ExecutionPlanRecord> }) => {
        const record: ExecutionPlanRecord = {
          id: `plan-${state.executionPlans.length + 1}`,
          sessionId: data.sessionId ?? 'session-owned-001',
          messageId: (data.messageId as string | null | undefined) ?? null,
          taskType: data.taskType ?? 'general_lookup',
          requiredEvidence: data.requiredEvidence ?? [],
          candidateTools: data.candidateTools ?? [],
          permissionChecks: data.permissionChecks ?? [],
          riskAssessment: (data.riskAssessment as RiskLevel) ?? RiskLevel.low,
          clarificationNeeds: data.clarificationNeeds ?? null,
          expectedAnswerShape: data.expectedAnswerShape ?? null,
          requiresMultiStepToolUse: data.requiresMultiStepToolUse ?? false,
          decision: (data.decision as ExecutionDecision) ?? ExecutionDecision.continue,
          createdAt: nextDate()
        };
        state.executionPlans.push(record);
        return record;
      })
    },
    toolCall: {
      create: jest.fn(async ({ data }: { data: Partial<ToolCallRecord> }) => {
        const record: ToolCallRecord = {
          id: `tool-call-${state.toolCalls.length + 1}`,
          requestId: data.requestId ?? 'req-generated',
          sessionId: data.sessionId ?? 'session-owned-001',
          messageId: (data.messageId as string | null | undefined) ?? null,
          toolName: data.toolName ?? 'mock.general.lookup',
          toolVersion: data.toolVersion ?? 'v1',
          inputSummary: data.inputSummary ?? null,
          permissionResult: data.permissionResult ?? null,
          outputSummary: data.outputSummary ?? null,
          status: (data.status as ToolCallStatus) ?? ToolCallStatus.pending,
          executionStatus: (data.executionStatus as ToolExecutionStatus) ?? ToolExecutionStatus.not_started,
          durationMs: (data.durationMs as number | null | undefined) ?? null,
          errorCode: (data.errorCode as string | null | undefined) ?? null,
          createdAt: nextDate(),
          executedAt: (data.executedAt as Date | null | undefined) ?? null
        };
        state.toolCalls.push(record);
        return record;
      }),
      findMany: jest.fn(async ({ where }: { where: { sessionId: string } }) =>
        state.toolCalls
          .filter((item) => item.sessionId === where.sessionId)
          .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
      )
    },
    evidenceRef: {
      create: jest.fn(async ({ data }: { data: Partial<EvidenceRefRecord> }) => {
        const record: EvidenceRefRecord = {
          id: `evidence-${state.evidenceRefs.length + 1}`,
          requestId: (data.requestId as string | null | undefined) ?? null,
          messageId: (data.messageId as string | null | undefined) ?? null,
          sourceType: (data.sourceType as EvidenceSourceType) ?? EvidenceSourceType.structured_record,
          sourceId: data.sourceId ?? 'source-001',
          toolCallId: (data.toolCallId as string | null | undefined) ?? null,
          documentId: (data.documentId as string | null | undefined) ?? null,
          chunkId: (data.chunkId as string | null | undefined) ?? null,
          entityType: (data.entityType as string | null | undefined) ?? null,
          entityId: (data.entityId as string | null | undefined) ?? null,
          fieldPaths: (data.fieldPaths as string[] | undefined) ?? [],
          timestamp: nextDate(),
          permissionSnapshot: data.permissionSnapshot ?? null,
          summary: data.summary ?? null
        };
        state.evidenceRefs.push(record);
        return record;
      }),
      findMany: jest.fn(async ({ where }: { where: { messageId: { in: string[] } } }) =>
        state.evidenceRefs
          .filter((item) => item.messageId && where.messageId.in.includes(item.messageId))
          .sort((left, right) => left.timestamp.getTime() - right.timestamp.getTime())
      )
    },
    auditEvent: {
      create: jest.fn(async ({ data }: { data: Partial<AuditEventRecord> }) => {
        const record: AuditEventRecord = {
          id: `audit-${state.auditEvents.length + 1}`,
          requestId: data.requestId ?? 'req-generated',
          timestamp: nextDate(),
          organizationId: data.organizationId ?? 'org-001',
          hostApp: data.hostApp ?? 'erp',
          actorId: data.actorId ?? 'actor-001',
          sessionId: (data.sessionId as string | null | undefined) ?? null,
          messageId: (data.messageId as string | null | undefined) ?? null,
          eventType: data.eventType ?? 'event',
          decision: (data.decision as string | null | undefined) ?? null,
          toolCallId: (data.toolCallId as string | null | undefined) ?? null,
          riskLevel: (data.riskLevel as RiskLevel | null | undefined) ?? null,
          permissionResult: data.permissionResult ?? null,
          evidenceRefIds: (data.evidenceRefIds as string[] | undefined) ?? [],
          durationMs: (data.durationMs as number | null | undefined) ?? null,
          metadata: data.metadata ?? null
        };
        state.auditEvents.push(record);
        return record;
      })
    },
    groundingCheck: {
      create: jest.fn(async ({ data }: { data: Partial<GroundingCheckRecord> }) => {
        const record: GroundingCheckRecord = {
          id: `grounding-${state.groundingChecks.length + 1}`,
          requestId: data.requestId ?? 'req-generated',
          messageId: data.messageId ?? 'message-generated',
          covered: data.covered ?? false,
          checkedClaimCount: data.checkedClaimCount ?? 0,
          unsupportedClaimCount: data.unsupportedClaimCount ?? 0,
          evidenceRefIds: data.evidenceRefIds ?? [],
          metadata: data.metadata ?? null,
          createdAt: nextDate()
        };
        state.groundingChecks.push(record);
        return record;
      })
    },
    answerDecision: {
      create: jest.fn(async ({ data }: { data: Partial<AnswerDecisionRecord> }) => {
        const record: AnswerDecisionRecord = {
          id: `answer-decision-${state.answerDecisions.length + 1}`,
          requestId: data.requestId ?? 'req-generated',
          messageId: data.messageId ?? 'message-generated',
          status: data.status ?? 'answered',
          noAnswerReason: data.noAnswerReason ?? null,
          clarificationQuestionId: data.clarificationQuestionId ?? null,
          groundingCheckId: data.groundingCheckId ?? null,
          metadata: data.metadata ?? null,
          createdAt: nextDate()
        };
        state.answerDecisions.push(record);
        return record;
      })
    }
  };
}

function createInitialState(): MockState {
  const baseDate = new Date('2026-06-16T00:00:00.000Z');
  return {
    sessions: [
      {
        id: 'session-owned-001',
        hostApp: 'erp',
        organizationId: 'org-001',
        actorId: 'actor-001',
        status: AssistantSessionStatus.active,
        createdAt: new Date(baseDate),
        updatedAt: new Date('2026-06-16T00:00:04.000Z'),
        lastMessageAt: new Date('2026-06-16T00:00:04.000Z')
      },
      {
        id: 'session-hidden-001',
        hostApp: 'erp',
        organizationId: 'org-001',
        actorId: 'actor-002',
        status: AssistantSessionStatus.active,
        createdAt: new Date(baseDate),
        updatedAt: new Date('2026-06-16T00:00:01.000Z'),
        lastMessageAt: new Date('2026-06-16T00:00:01.000Z')
      },
      {
        id: 'session-closed-001',
        hostApp: 'erp',
        organizationId: 'org-001',
        actorId: 'actor-001',
        status: AssistantSessionStatus.closed,
        createdAt: new Date(baseDate),
        updatedAt: new Date('2026-06-16T00:00:05.000Z'),
        lastMessageAt: new Date('2026-06-16T00:00:05.000Z')
      },
      {
        id: 'session-expired-001',
        hostApp: 'erp',
        organizationId: 'org-001',
        actorId: 'actor-001',
        status: AssistantSessionStatus.expired,
        createdAt: new Date(baseDate),
        updatedAt: new Date('2026-06-16T00:00:06.000Z'),
        lastMessageAt: new Date('2026-06-16T00:00:06.000Z')
      }
    ],
    contextStates: [
      {
        id: 'context-owned-001',
        sessionId: 'session-owned-001',
        currentTask: 'order_status_lookup',
        currentModule: 'orders',
        currentPage: {
          module: 'orders',
          screenId: 'order-detail',
          entityType: 'order',
          entityId: 'SO-10001',
          visibleColumns: ['status', 'customerName']
        },
        currentEntityType: 'order',
        currentEntityId: 'SO-10001',
        lastIntent: 'order_status_lookup',
        lastEntities: [{ type: 'orderId', value: 'SO-10001' }],
        lastToolCallIds: ['tool-call-owned-001'],
        lastEvidenceRefIds: ['evidence-owned-001'],
        pendingClarification: null,
        pendingApprovalRequestId: null,
        taskState: AssistantTaskState.completed,
        createdAt: new Date('2026-06-16T00:00:01.000Z'),
        updatedAt: new Date('2026-06-16T00:00:04.000Z')
      },
      {
        id: 'context-hidden-001',
        sessionId: 'session-hidden-001',
        currentTask: 'order_status_lookup',
        currentModule: 'orders',
        currentPage: null,
        currentEntityType: 'order',
        currentEntityId: 'SO-20002',
        lastIntent: 'order_status_lookup',
        lastEntities: [{ type: 'orderId', value: 'SO-20002' }],
        lastToolCallIds: [],
        lastEvidenceRefIds: [],
        pendingClarification: null,
        pendingApprovalRequestId: null,
        taskState: AssistantTaskState.idle,
        createdAt: new Date('2026-06-16T00:00:01.000Z'),
        updatedAt: new Date('2026-06-16T00:00:01.000Z')
      }
    ],
    messages: [
      {
        id: 'message-owned-user-001',
        sessionId: 'session-owned-001',
        requestId: 'req-history-seed-001',
        role: AssistantMessageRole.user,
        content: '這張訂單目前狀態？',
        answerDecision: null,
        pageContext: null,
        createdAt: new Date('2026-06-16T00:00:02.000Z')
      },
      {
        id: 'message-owned-assistant-001',
        sessionId: 'session-owned-001',
        requestId: 'req-history-seed-001',
        role: AssistantMessageRole.assistant,
        content: '這張訂單目前狀態為已確認，客戶名稱是王小明企業。',
        answerDecision: 'answered',
        pageContext: null,
        createdAt: new Date('2026-06-16T00:00:04.000Z')
      }
    ],
    toolDefinitions: createToolDefinitions(baseDate),
    toolCalls: [
      {
        id: 'tool-call-owned-001',
        requestId: 'req-history-seed-001',
        sessionId: 'session-owned-001',
        messageId: 'message-owned-assistant-001',
        toolName: 'mock.orders.status.lookup',
        toolVersion: '1.0.0',
        inputSummary: { entityId: 'SO-10001' },
        permissionResult: { scopes: ['orders:read'] },
        outputSummary: { status: '已確認', customerName: '王小明企業' },
        status: ToolCallStatus.success,
        executionStatus: ToolExecutionStatus.executed,
        durationMs: 1,
        errorCode: null,
        createdAt: new Date('2026-06-16T00:00:03.000Z'),
        executedAt: new Date('2026-06-16T00:00:03.000Z')
      }
    ],
    evidenceRefs: [
      {
        id: 'evidence-owned-001',
        requestId: 'req-history-seed-001',
        messageId: 'message-owned-assistant-001',
        sourceType: EvidenceSourceType.structured_record,
        sourceId: 'SO-10001',
        toolCallId: 'tool-call-owned-001',
        documentId: null,
        chunkId: null,
        entityType: 'order',
        entityId: 'SO-10001',
        fieldPaths: ['status', 'customerName'],
        timestamp: new Date('2026-06-16T00:00:03.500Z'),
        permissionSnapshot: { visibleFields: ['status', 'customerName'] },
        summary: { fields: { status: '已確認', customerName: '王小明企業' } }
      }
    ],
    auditEvents: [],
    queryUnderstandingResults: [],
    executionPlans: [],
    groundingChecks: [],
    answerDecisions: []
  };
}

function createToolDefinitions(baseDate: Date): ToolDefinitionRecord[] {
  return [
    createToolDefinition({
      id: 'tool-definition-orders-001',
      name: 'mock.orders.status.lookup',
      description: 'Lookup mock order status.',
      resource: 'orders',
      requiredPermissions: ['orders:read'],
      outputRequired: ['orderId', 'status'],
      baseDate
    }),
    createToolDefinition({
      id: 'tool-definition-work-orders-001',
      name: 'mock.work-orders.progress.lookup',
      description: 'Lookup mock work order progress.',
      resource: 'work_orders',
      requiredPermissions: ['work-orders:read'],
      outputRequired: ['workOrderId', 'status'],
      baseDate
    }),
    createToolDefinition({
      id: 'tool-definition-inventory-001',
      name: 'mock.inventory.availability.lookup',
      description: 'Lookup mock inventory availability.',
      resource: 'inventory',
      requiredPermissions: ['inventory:read'],
      outputRequired: ['itemSku', 'availableQuantity'],
      baseDate
    }),
    createToolDefinition({
      id: 'tool-definition-business-partner-001',
      name: 'mock.business-partner.history.lookup',
      description: 'Lookup mock customer or supplier history.',
      resource: 'business_partners',
      requiredPermissions: ['business-partners:read'],
      outputRequired: ['partnerId', 'relationshipStatus'],
      baseDate
    })
  ];
}

function createToolDefinition(input: {
  id: string;
  name: string;
  description: string;
  resource: string;
  requiredPermissions: string[];
  outputRequired: string[];
  baseDate: Date;
}): ToolDefinitionRecord {
  return {
    id: input.id,
    name: input.name,
    version: '1.0.0',
    description: input.description,
    resource: input.resource,
    operation: ToolOperation.read,
    inputSchema: {
      type: 'object',
      required: ['entityId'],
      properties: {
        entityId: { type: 'string' }
      }
    },
    outputSchema: {
      type: 'object',
      required: input.outputRequired
    },
    requiredPermissions: input.requiredPermissions,
    riskLevel: RiskLevel.low,
    hasSideEffect: false,
    requiresConfirmation: false,
    requiresApproval: false,
    connectorKey: 'mock',
    timeoutMs: 3000,
    auditBehavior: {
      summarizeInput: true,
      summarizeOutput: true
    },
    isActive: true,
    createdAt: new Date(input.baseDate),
    updatedAt: new Date(input.baseDate)
  };
}

let mockTick = 0;

function nextDate() {
  mockTick += 1;
  return new Date(`2026-06-16T00:00:${String(10 + mockTick).padStart(2, '0')}.000Z`);
}
