import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  AssistantMessageRole,
  AssistantSessionStatus,
  AssistantTaskState,
  ActionDraftStatus,
  ApprovalRequestStatus,
  EscalationOwnerType,
  EscalationReason,
  EscalationStatus,
  EvidenceSourceType,
  ExecutionDecision,
  ClarificationQuestionStatus,
  ReviewItemStatus,
  ReviewPriority,
  ReviewSourceType,
  FeedbackRating,
  RiskLevel,
  KnowledgeDocumentStatus,
  KnowledgeSourceType,
  ToolCallStatus,
  ToolExecutionStatus,
  ToolOperation,
  RetrievalStrategy
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
  toolDefinitionId: string | null;
  toolName: string;
  toolVersion: string;
  inputSummary: unknown;
  permissionResult: unknown;
  outputSummary: unknown;
  status: ToolCallStatus;
  executionStatus: ToolExecutionStatus;
  idempotencyKey: string | null;
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

type ActionDraftRecord = {
  id: string;
  requestId: string;
  sessionId: string;
  messageId: string | null;
  actorId: string;
  toolName: string;
  resource: string;
  operation: ToolOperation;
  riskLevel: RiskLevel;
  payloadSummary: unknown;
  preview: unknown;
  status: ActionDraftStatus;
  idempotencyKey: string | null;
  createdAt: Date;
  confirmedAt: Date | null;
  executedAt: Date | null;
  expiresAt: Date | null;
};

type ApprovalRequestRecord = {
  id: string;
  requestId: string;
  sessionId: string;
  messageId: string | null;
  requesterActorId: string;
  approverActorId: string | null;
  riskLevel: RiskLevel;
  status: ApprovalRequestStatus;
  actionSummary: unknown;
  payloadSummary: unknown;
  evidenceRefIds: string[];
  decisionReason: string | null;
  idempotencyKey: string | null;
  auditEventIds: string[];
  expiresAt: Date | null;
  createdAt: Date;
  decidedAt: Date | null;
};

type EscalationRequestRecord = {
  id: string;
  requestId: string;
  sessionId: string;
  messageId: string | null;
  reason: EscalationReason;
  status: EscalationStatus;
  ownerType: EscalationOwnerType;
  summary: unknown;
  createdAt: Date;
  resolvedAt: Date | null;
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

type ClarificationQuestionRecord = {
  id: string;
  requestId: string;
  messageId: string;
  question: string;
  reason: string | null;
  status: ClarificationQuestionStatus;
  metadata: unknown;
  createdAt: Date;
  answeredAt: Date | null;
};

type ReviewItemRecord = {
  id: string;
  sourceType: ReviewSourceType;
  sourceId: string;
  status: ReviewItemStatus;
  priority: ReviewPriority;
  summary: string;
  suggestedImprovement: unknown;
  createdAt: Date;
  resolvedAt: Date | null;
};

type FeedbackEventRecord = {
  id: string;
  requestId: string;
  messageId: string;
  rating: FeedbackRating;
  reason: string | null;
  comment: string | null;
  intent: string | null;
  toolCallIds: string[];
  evidenceRefIds: string[];
  answerDecision: string | null;
  createdAt: Date;
};

type KnowledgeDocumentRecord = {
  id: string;
  title: string;
  sourceType: KnowledgeSourceType;
  sourceKey: string;
  version: string;
  language: string;
  status: KnowledgeDocumentStatus;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
};

type KnowledgeChunkRecord = {
  id: string;
  documentId: string;
  chunkIndex: number;
  heading: string | null;
  content: string;
  tokenCount: number;
  metadata: unknown;
  embeddingRef: string | null;
  vectorId: string | null;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
};

type RetrievalRunRecord = {
  id: string;
  requestId: string;
  messageId: string | null;
  query: string;
  normalizedQuery: string | null;
  filters: unknown;
  strategy: RetrievalStrategy;
  selectedEvidenceRefIds: string[];
  noAnswerReason: string | null;
  durationMs: number | null;
  createdAt: Date;
};

type RetrievalCandidateRecord = {
  id: string;
  retrievalRunId: string;
  chunkId: string | null;
  sourceId: string;
  sourceType: EvidenceSourceType;
  score: number;
  rank: number;
  selected: boolean;
  reason: string | null;
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
  actionDrafts: ActionDraftRecord[];
  approvalRequests: ApprovalRequestRecord[];
  escalationRequests: EscalationRequestRecord[];
  toolCalls: ToolCallRecord[];
  evidenceRefs: EvidenceRefRecord[];
  auditEvents: AuditEventRecord[];
  queryUnderstandingResults: QueryUnderstandingRecord[];
  executionPlans: ExecutionPlanRecord[];
  groundingChecks: GroundingCheckRecord[];
  answerDecisions: AnswerDecisionRecord[];
  clarificationQuestions: ClarificationQuestionRecord[];
  reviewItems: ReviewItemRecord[];
  feedbackEvents: FeedbackEventRecord[];
  knowledgeDocuments: KnowledgeDocumentRecord[];
  knowledgeChunks: KnowledgeChunkRecord[];
  retrievalRuns: RetrievalRunRecord[];
  retrievalCandidates: RetrievalCandidateRecord[];
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
      }),
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
        state.messages.find((item) => item.id === where.id) ?? null
      )
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
    actionDraft: {
      create: jest.fn(async ({ data }: { data: Partial<ActionDraftRecord> }) => {
        const record: ActionDraftRecord = {
          id: `action-draft-created-${state.actionDrafts.length + 1}`,
          requestId: data.requestId ?? 'req-generated',
          sessionId: data.sessionId ?? 'session-owned-001',
          messageId: (data.messageId as string | null | undefined) ?? null,
          actorId: data.actorId ?? 'actor-001',
          toolName: data.toolName ?? 'mock.orders.status.lookup',
          resource: data.resource ?? 'orders',
          operation: (data.operation as ToolOperation) ?? ToolOperation.update,
          riskLevel: (data.riskLevel as RiskLevel) ?? RiskLevel.medium,
          payloadSummary: data.payloadSummary ?? {},
          preview: data.preview ?? {},
          status: (data.status as ActionDraftStatus) ?? ActionDraftStatus.draft,
          idempotencyKey: (data.idempotencyKey as string | null | undefined) ?? null,
          createdAt: nextDate(),
          confirmedAt: (data.confirmedAt as Date | null | undefined) ?? null,
          executedAt: (data.executedAt as Date | null | undefined) ?? null,
          expiresAt: (data.expiresAt as Date | null | undefined) ?? null
        };
        state.actionDrafts.push(record);
        return record;
      }),
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => state.actionDrafts.find((item) => item.id === where.id) ?? null),
      findFirst: jest.fn(
        async ({
          where
        }: {
          where: {
            id?: string;
            sessionId?: string;
            actorId?: string;
            status?: ActionDraftStatus;
          };
        }) =>
          state.actionDrafts.find(
            (item) =>
              (!where.id || item.id === where.id) &&
              (!where.sessionId || item.sessionId === where.sessionId) &&
              (!where.actorId || item.actorId === where.actorId) &&
              (!where.status || item.status === where.status)
          ) ?? null
      ),
      findMany: jest.fn(
        async ({
          where
        }: {
          where?: {
            sessionId?: string;
            actorId?: string;
            status?: ActionDraftStatus;
          };
        } = {}) =>
          state.actionDrafts.filter(
            (item) =>
              (!where?.sessionId || item.sessionId === where.sessionId) &&
              (!where?.actorId || item.actorId === where.actorId) &&
              (!where?.status || item.status === where.status)
          )
      ),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<ActionDraftRecord> }) => {
        const draft = state.actionDrafts.find((item) => item.id === where.id);
        if (!draft) {
          throw new Error(`ActionDraft ${where.id} not found.`);
        }

        Object.assign(draft, data);
        return draft;
      })
    },
    approvalRequest: {
      create: jest.fn(async ({ data }: { data: Partial<ApprovalRequestRecord> }) => {
        const record: ApprovalRequestRecord = {
          id: `approval-request-created-${state.approvalRequests.length + 1}`,
          requestId: data.requestId ?? 'req-generated',
          sessionId: data.sessionId ?? 'session-owned-001',
          messageId: (data.messageId as string | null | undefined) ?? null,
          requesterActorId: data.requesterActorId ?? 'actor-001',
          approverActorId: (data.approverActorId as string | null | undefined) ?? null,
          riskLevel: (data.riskLevel as RiskLevel) ?? RiskLevel.high,
          status: (data.status as ApprovalRequestStatus) ?? ApprovalRequestStatus.pending,
          actionSummary: data.actionSummary ?? {},
          payloadSummary: data.payloadSummary ?? {},
          evidenceRefIds: (data.evidenceRefIds as string[] | undefined) ?? [],
          decisionReason: (data.decisionReason as string | null | undefined) ?? null,
          idempotencyKey: (data.idempotencyKey as string | null | undefined) ?? null,
          auditEventIds: (data.auditEventIds as string[] | undefined) ?? [],
          expiresAt: (data.expiresAt as Date | null | undefined) ?? null,
          createdAt: nextDate(),
          decidedAt: (data.decidedAt as Date | null | undefined) ?? null
        };
        state.approvalRequests.push(record);
        return record;
      }),
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => state.approvalRequests.find((item) => item.id === where.id) ?? null),
      findFirst: jest.fn(
        async ({
          where
        }: {
          where: {
            id?: string;
            sessionId?: string;
            requesterActorId?: string;
            approverActorId?: string;
            status?: ApprovalRequestStatus;
          };
        }) =>
          state.approvalRequests.find(
            (item) =>
              (!where.id || item.id === where.id) &&
              (!where.sessionId || item.sessionId === where.sessionId) &&
              (!where.requesterActorId || item.requesterActorId === where.requesterActorId) &&
              (!where.approverActorId || item.approverActorId === where.approverActorId) &&
              (!where.status || item.status === where.status)
          ) ?? null
      ),
      findMany: jest.fn(
        async ({
          where,
          orderBy
        }: {
          where?: {
            status?: ApprovalRequestStatus;
            riskLevel?: RiskLevel;
            requesterActorId?: string;
            approverActorId?: string;
            createdAt?: { gte?: Date; lte?: Date };
          };
          orderBy?: { createdAt: 'asc' | 'desc' };
        } = {}) =>
          state.approvalRequests
            .filter(
              (item) =>
                (!where?.status || item.status === where.status) &&
                (!where?.riskLevel || item.riskLevel === where.riskLevel) &&
                (!where?.requesterActorId || item.requesterActorId === where.requesterActorId) &&
                (!where?.approverActorId || item.approverActorId === where.approverActorId) &&
                (!where?.createdAt?.gte || item.createdAt.getTime() >= where.createdAt.gte.getTime()) &&
                (!where?.createdAt?.lte || item.createdAt.getTime() <= where.createdAt.lte.getTime())
            )
            .sort((left, right) =>
              (orderBy?.createdAt ?? 'desc') === 'desc'
                ? right.createdAt.getTime() - left.createdAt.getTime()
                : left.createdAt.getTime() - right.createdAt.getTime()
            )
      ),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<ApprovalRequestRecord> }) => {
        const approvalRequest = state.approvalRequests.find((item) => item.id === where.id);
        if (!approvalRequest) {
          throw new Error(`ApprovalRequest ${where.id} not found.`);
        }

        Object.assign(approvalRequest, data);
        return approvalRequest;
      })
    },
    escalationRequest: {
      create: jest.fn(async ({ data }: { data: Partial<EscalationRequestRecord> }) => {
        const record: EscalationRequestRecord = {
          id: `escalation-request-created-${state.escalationRequests.length + 1}`,
          requestId: data.requestId ?? 'req-generated',
          sessionId: data.sessionId ?? 'session-owned-001',
          messageId: (data.messageId as string | null | undefined) ?? null,
          reason: (data.reason as EscalationReason) ?? EscalationReason.policy_required,
          status: (data.status as EscalationStatus) ?? EscalationStatus.open,
          ownerType: (data.ownerType as EscalationOwnerType) ?? EscalationOwnerType.approver,
          summary: data.summary ?? {},
          createdAt: nextDate(),
          resolvedAt: (data.resolvedAt as Date | null | undefined) ?? null
        };
        state.escalationRequests.push(record);
        return record;
      }),
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => state.escalationRequests.find((item) => item.id === where.id) ?? null),
      findFirst: jest.fn(
        async ({
          where
        }: {
          where: {
            id?: string;
            sessionId?: string;
            status?: EscalationStatus;
          };
        }) =>
          state.escalationRequests.find(
            (item) =>
              (!where.id || item.id === where.id) &&
              (!where.sessionId || item.sessionId === where.sessionId) &&
              (!where.status || item.status === where.status)
          ) ?? null
      ),
      findMany: jest.fn(
        async ({
          where,
          orderBy
        }: {
          where?: {
            status?: EscalationStatus;
          };
          orderBy?: { createdAt: 'asc' | 'desc' };
        } = {}) =>
          state.escalationRequests
            .filter((item) => !where?.status || item.status === where.status)
            .sort((left, right) =>
              (orderBy?.createdAt ?? 'desc') === 'desc'
                ? right.createdAt.getTime() - left.createdAt.getTime()
                : left.createdAt.getTime() - right.createdAt.getTime()
            )
      ),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<EscalationRequestRecord> }) => {
        const escalationRequest = state.escalationRequests.find((item) => item.id === where.id);
        if (!escalationRequest) {
          throw new Error(`EscalationRequest ${where.id} not found.`);
        }

        Object.assign(escalationRequest, data);
        return escalationRequest;
      })
    },
    toolCall: {
      create: jest.fn(async ({ data }: { data: Partial<ToolCallRecord> }) => {
        const record: ToolCallRecord = {
          id: `tool-call-${state.toolCalls.length + 1}`,
          requestId: data.requestId ?? 'req-generated',
          sessionId: data.sessionId ?? 'session-owned-001',
          messageId: (data.messageId as string | null | undefined) ?? null,
          toolDefinitionId: (data.toolDefinitionId as string | null | undefined) ?? null,
          toolName: data.toolName ?? 'mock.general.lookup',
          toolVersion: data.toolVersion ?? '1.0.0',
          inputSummary: data.inputSummary ?? null,
          permissionResult: data.permissionResult ?? null,
          outputSummary: data.outputSummary ?? null,
          status: (data.status as ToolCallStatus) ?? ToolCallStatus.pending,
          executionStatus: (data.executionStatus as ToolExecutionStatus) ?? ToolExecutionStatus.not_started,
          idempotencyKey: (data.idempotencyKey as string | null | undefined) ?? null,
          durationMs: (data.durationMs as number | null | undefined) ?? null,
          errorCode: (data.errorCode as string | null | undefined) ?? null,
          createdAt: nextDate(),
          executedAt: (data.executedAt as Date | null | undefined) ?? null
        };
        state.toolCalls.push(record);
        return record;
      }),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<ToolCallRecord> }) => {
        const toolCall = state.toolCalls.find((item) => item.id === where.id);
        if (!toolCall) {
          throw new Error(`ToolCall ${where.id} not found.`);
        }

        Object.assign(toolCall, data);
        return toolCall;
      }),
      findMany: jest.fn(async ({ where }: { where: { sessionId?: string; messageId?: string } }) =>
        state.toolCalls
          .filter((item) => (!where.sessionId || item.sessionId === where.sessionId) && (!where.messageId || item.messageId === where.messageId))
          .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
      ),
      findFirst: jest.fn(
        async ({ where }: { where: { idempotencyKey?: string | null } }) =>
          state.toolCalls.find((item) => where.idempotencyKey && item.idempotencyKey === where.idempotencyKey) ?? null
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
    },
    clarificationQuestion: {
      create: jest.fn(async ({ data }: { data: Partial<ClarificationQuestionRecord> }) => {
        const record: ClarificationQuestionRecord = {
          id: `clarification-question-${state.clarificationQuestions.length + 1}`,
          requestId: data.requestId ?? 'req-generated',
          messageId: data.messageId ?? 'message-generated',
          question: data.question ?? '請補充查詢目標。',
          reason: (data.reason as string | null | undefined) ?? null,
          status: (data.status as ClarificationQuestionStatus | undefined) ?? ClarificationQuestionStatus.pending,
          metadata: data.metadata ?? null,
          createdAt: nextDate(),
          answeredAt: (data.answeredAt as Date | null | undefined) ?? null
        };
        state.clarificationQuestions.push(record);
        return record;
      }),
      findMany: jest.fn(
        async ({ where }: { where?: { requestId?: string; messageId?: string; status?: ClarificationQuestionStatus } } = {}) =>
          state.clarificationQuestions.filter(
            (item) =>
              (!where?.requestId || item.requestId === where.requestId) &&
              (!where?.messageId || item.messageId === where.messageId) &&
              (!where?.status || item.status === where.status)
          )
      ),
      findFirst: jest.fn(
        async ({ where }: { where?: { id?: string; requestId?: string; messageId?: string } } = {}) =>
          state.clarificationQuestions.find(
            (item) =>
              (!where?.id || item.id === where.id) &&
              (!where?.requestId || item.requestId === where.requestId) &&
              (!where?.messageId || item.messageId === where.messageId)
          ) ?? null
      )
    },
    reviewItem: {
      create: jest.fn(async ({ data }: { data: Partial<ReviewItemRecord> }) => {
        const record: ReviewItemRecord = {
          id: `review-item-${state.reviewItems.length + 1}`,
          sourceType: (data.sourceType as ReviewSourceType | undefined) ?? ReviewSourceType.no_answer,
          sourceId: data.sourceId ?? 'source-generated',
          status: (data.status as ReviewItemStatus | undefined) ?? ReviewItemStatus.open,
          priority: (data.priority as ReviewPriority | undefined) ?? ReviewPriority.medium,
          summary: data.summary ?? 'Review required.',
          suggestedImprovement: data.suggestedImprovement ?? null,
          createdAt: nextDate(),
          resolvedAt: (data.resolvedAt as Date | null | undefined) ?? null
        };
        state.reviewItems.push(record);
        return record;
      }),
      findMany: jest.fn(
        async ({ where }: { where?: { sourceType?: ReviewSourceType; sourceId?: string; status?: ReviewItemStatus; priority?: ReviewPriority } } = {}) =>
          state.reviewItems.filter(
            (item) =>
              (!where?.sourceType || item.sourceType === where.sourceType) &&
              (!where?.sourceId || item.sourceId === where.sourceId) &&
              (!where?.status || item.status === where.status) &&
              (!where?.priority || item.priority === where.priority)
          )
      ),
      findFirst: jest.fn(
        async ({ where }: { where?: { sourceType?: ReviewSourceType; sourceId?: string } } = {}) =>
          state.reviewItems.find(
            (item) =>
              (!where?.sourceType || item.sourceType === where.sourceType) &&
              (!where?.sourceId || item.sourceId === where.sourceId)
          ) ?? null
      ),
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
        state.reviewItems.find((item) => item.id === where.id) ?? null
      ),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<ReviewItemRecord> }) => {
        const reviewItem = state.reviewItems.find((item) => item.id === where.id);
        if (!reviewItem) {
          throw new Error(`ReviewItem ${where.id} not found.`);
        }

        Object.assign(reviewItem, data);
        return reviewItem;
      })
    },
    feedbackEvent: {
      create: jest.fn(async ({ data }: { data: Partial<FeedbackEventRecord> }) => {
        const record: FeedbackEventRecord = {
          id: `feedback-event-${state.feedbackEvents.length + 1}`,
          requestId: data.requestId ?? 'req-generated',
          messageId: data.messageId ?? 'message-owned-assistant-001',
          rating: (data.rating as FeedbackRating | undefined) ?? FeedbackRating.positive,
          reason: (data.reason as string | null | undefined) ?? null,
          comment: (data.comment as string | null | undefined) ?? null,
          intent: (data.intent as string | null | undefined) ?? null,
          toolCallIds: (data.toolCallIds as string[] | undefined) ?? [],
          evidenceRefIds: (data.evidenceRefIds as string[] | undefined) ?? [],
          answerDecision: (data.answerDecision as string | null | undefined) ?? null,
          createdAt: nextDate()
        };
        state.feedbackEvents.push(record);
        return record;
      }),
      findMany: jest.fn(async ({ where }: { where?: { messageId?: string; rating?: FeedbackRating } } = {}) =>
        state.feedbackEvents.filter(
          (item) =>
            (!where?.messageId || item.messageId === where.messageId) &&
            (!where?.rating || item.rating === where.rating)
        )
      ),
      findFirst: jest.fn(async ({ where }: { where?: { id?: string; messageId?: string } } = {}) =>
        state.feedbackEvents.find(
          (item) =>
            (!where?.id || item.id === where.id) &&
            (!where?.messageId || item.messageId === where.messageId)
        ) ?? null
      )
    },
    knowledgeDocument: {
      findMany: jest.fn(
        async ({ where }: { where?: { status?: KnowledgeDocumentStatus; sourceType?: KnowledgeSourceType } } = {}) =>
          state.knowledgeDocuments.filter(
            (item) =>
              (!where?.status || item.status === where.status) &&
              (!where?.sourceType || item.sourceType === where.sourceType)
          )
      ),
      create: jest.fn(async ({ data }: { data: Partial<KnowledgeDocumentRecord> }) => {
        const record: KnowledgeDocumentRecord = {
          id: data.id ?? `knowledge-document-${state.knowledgeDocuments.length + 1}`,
          title: data.title ?? 'Knowledge document',
          sourceType: (data.sourceType as KnowledgeSourceType | undefined) ?? KnowledgeSourceType.sop,
          sourceKey: data.sourceKey ?? `knowledge-source-${state.knowledgeDocuments.length + 1}`,
          version: data.version ?? '1.0.0',
          language: data.language ?? 'zh-TW',
          status: (data.status as KnowledgeDocumentStatus | undefined) ?? KnowledgeDocumentStatus.active,
          metadata: data.metadata ?? null,
          createdAt: nextDate(),
          updatedAt: nextDate()
        };
        state.knowledgeDocuments.push(record);
        return record;
      })
    },
    knowledgeChunk: {
      findMany: jest.fn(
        async ({
          where,
          include,
          orderBy
        }: {
          where?: {
            enabled?: boolean;
            document?: { status?: KnowledgeDocumentStatus };
          };
          include?: { document?: boolean };
          orderBy?: Array<{ documentId?: 'asc' | 'desc'; chunkIndex?: 'asc' | 'desc' }>;
        } = {}) => {
          const chunks = state.knowledgeChunks
            .filter((item) => where?.enabled === undefined || item.enabled === where.enabled)
            .filter((item) => {
              if (!where?.document?.status) {
                return true;
              }
              const document = state.knowledgeDocuments.find((doc) => doc.id === item.documentId);
              return document?.status === where.document.status;
            })
            .sort((left, right) => {
              for (const order of orderBy ?? []) {
                if (order.documentId) {
                  const comparison = left.documentId.localeCompare(right.documentId);
                  if (comparison !== 0) return order.documentId === 'asc' ? comparison : -comparison;
                }
                if (order.chunkIndex) {
                  const comparison = left.chunkIndex - right.chunkIndex;
                  if (comparison !== 0) return order.chunkIndex === 'asc' ? comparison : -comparison;
                }
              }
              return left.chunkIndex - right.chunkIndex;
            });

          if (!include?.document) {
            return chunks;
          }

          return chunks.map((chunk) => ({
            ...chunk,
            document: state.knowledgeDocuments.find((document) => document.id === chunk.documentId) ?? null
          }));
        }
      ),
      create: jest.fn(async ({ data }: { data: Partial<KnowledgeChunkRecord> }) => {
        const record: KnowledgeChunkRecord = {
          id: data.id ?? `knowledge-chunk-${state.knowledgeChunks.length + 1}`,
          documentId: data.documentId ?? 'knowledge-document-sop-return-001',
          chunkIndex: data.chunkIndex ?? state.knowledgeChunks.length,
          heading: (data.heading as string | null | undefined) ?? null,
          content: data.content ?? '',
          tokenCount: data.tokenCount ?? 0,
          metadata: data.metadata ?? null,
          embeddingRef: (data.embeddingRef as string | null | undefined) ?? null,
          vectorId: (data.vectorId as string | null | undefined) ?? null,
          enabled: data.enabled ?? true,
          createdAt: nextDate(),
          updatedAt: nextDate()
        };
        state.knowledgeChunks.push(record);
        return record;
      })
    },
    retrievalRun: {
      create: jest.fn(async ({ data }: { data: Partial<RetrievalRunRecord> }) => {
        const record: RetrievalRunRecord = {
          id: `retrieval-run-${state.retrievalRuns.length + 1}`,
          requestId: data.requestId ?? 'req-generated',
          messageId: (data.messageId as string | null | undefined) ?? null,
          query: data.query ?? '',
          normalizedQuery: (data.normalizedQuery as string | null | undefined) ?? null,
          filters: data.filters ?? null,
          strategy: (data.strategy as RetrievalStrategy | undefined) ?? RetrievalStrategy.keyword,
          selectedEvidenceRefIds: (data.selectedEvidenceRefIds as string[] | undefined) ?? [],
          noAnswerReason: (data.noAnswerReason as string | null | undefined) ?? null,
          durationMs: (data.durationMs as number | null | undefined) ?? null,
          createdAt: nextDate()
        };
        state.retrievalRuns.push(record);
        return record;
      }),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<RetrievalRunRecord> }) => {
        const retrievalRun = state.retrievalRuns.find((item) => item.id === where.id);
        if (!retrievalRun) {
          throw new Error(`RetrievalRun ${where.id} not found.`);
        }

        Object.assign(retrievalRun, data);
        return retrievalRun;
      }),
      findMany: jest.fn(async ({ where }: { where?: { requestId?: string; messageId?: string } } = {}) =>
        state.retrievalRuns.filter(
          (item) =>
            (!where?.requestId || item.requestId === where.requestId) &&
            (!where?.messageId || item.messageId === where.messageId)
        )
      )
    },
    retrievalCandidate: {
      create: jest.fn(async ({ data }: { data: Partial<RetrievalCandidateRecord> }) => {
        const record: RetrievalCandidateRecord = {
          id: `retrieval-candidate-${state.retrievalCandidates.length + 1}`,
          retrievalRunId: data.retrievalRunId ?? 'retrieval-run-1',
          chunkId: (data.chunkId as string | null | undefined) ?? null,
          sourceId: data.sourceId ?? 'source-001',
          sourceType: (data.sourceType as EvidenceSourceType | undefined) ?? EvidenceSourceType.document_chunk,
          score: data.score ?? 0,
          rank: data.rank ?? state.retrievalCandidates.length + 1,
          selected: data.selected ?? false,
          reason: (data.reason as string | null | undefined) ?? null
        };
        state.retrievalCandidates.push(record);
        return record;
      }),
      findMany: jest.fn(async ({ where }: { where?: { retrievalRunId?: string; selected?: boolean } } = {}) =>
        state.retrievalCandidates.filter(
          (item) =>
            (!where?.retrievalRunId || item.retrievalRunId === where.retrievalRunId) &&
            (where?.selected === undefined || item.selected === where.selected)
        )
      )
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
    actionDrafts: createActionDrafts(baseDate),
    approvalRequests: createApprovalRequests(baseDate),
    escalationRequests: createEscalationRequests(baseDate),
    toolCalls: [
      {
        id: 'tool-call-owned-001',
        requestId: 'req-history-seed-001',
        sessionId: 'session-owned-001',
        messageId: 'message-owned-assistant-001',
        toolDefinitionId: 'tool-definition-orders-001',
        toolName: 'mock.orders.status.lookup',
        toolVersion: '1.0.0',
        inputSummary: { entityId: 'SO-10001' },
        permissionResult: { scopes: ['orders:read'] },
        outputSummary: { status: '已確認', customerName: '王小明企業' },
        status: ToolCallStatus.success,
        executionStatus: ToolExecutionStatus.executed,
        idempotencyKey: null,
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
    answerDecisions: [],
    clarificationQuestions: [],
    reviewItems: createReviewItems(baseDate),
    feedbackEvents: [],
    knowledgeDocuments: createKnowledgeDocuments(baseDate),
    knowledgeChunks: createKnowledgeChunks(baseDate),
    retrievalRuns: [],
    retrievalCandidates: []
  };
}

function createReviewItems(baseDate: Date): ReviewItemRecord[] {
  return [
    {
      id: 'review-item-open-feedback-001',
      sourceType: ReviewSourceType.negative_feedback,
      sourceId: 'feedback-event-seed-001',
      status: ReviewItemStatus.open,
      priority: ReviewPriority.medium,
      summary: 'not_helpful: feedback requires review',
      suggestedImprovement: {
        organizationId: 'org-001',
        hostApp: 'erp',
        requestId: 'req-history-seed-001',
        messageId: 'message-owned-assistant-001',
        feedbackEventId: 'feedback-event-seed-001',
        answerDecision: 'answered',
        toolCallIds: ['tool-call-owned-001'],
        evidenceRefIds: ['evidence-owned-001'],
        rating: 'negative',
        intent: 'not_helpful',
        reasonProvided: true,
        commentProvided: false
      },
      createdAt: new Date(baseDate),
      resolvedAt: null
    },
    {
      id: 'review-item-hidden-org-001',
      sourceType: ReviewSourceType.negative_feedback,
      sourceId: 'feedback-event-hidden-001',
      status: ReviewItemStatus.open,
      priority: ReviewPriority.high,
      summary: 'hidden review item',
      suggestedImprovement: {
        organizationId: 'org-hidden',
        hostApp: 'erp',
        requestId: 'req-hidden',
        messageId: 'message-hidden',
        feedbackEventId: 'feedback-event-hidden-001',
        rating: 'negative',
        intent: 'unsafe',
        reasonProvided: true,
        commentProvided: false
      },
      createdAt: new Date(baseDate),
      resolvedAt: null
    },
    {
      id: 'review-item-open-feedback-002',
      sourceType: ReviewSourceType.missing_evidence,
      sourceId: 'feedback-event-seed-002',
      status: ReviewItemStatus.open,
      priority: ReviewPriority.high,
      summary: 'missing_evidence: feedback requires review',
      suggestedImprovement: {
        organizationId: 'org-001',
        hostApp: 'erp',
        requestId: 'req-history-seed-001',
        messageId: 'message-owned-assistant-001',
        feedbackEventId: 'feedback-event-seed-002',
        answerDecision: 'answered',
        toolCallIds: ['tool-call-owned-001'],
        evidenceRefIds: ['evidence-owned-001'],
        rating: 'negative',
        intent: 'missing_evidence',
        reasonProvided: true,
        commentProvided: false
      },
      createdAt: new Date(baseDate),
      resolvedAt: null
    }
  ];
}

function createKnowledgeDocuments(baseDate: Date): KnowledgeDocumentRecord[] {
  return [
    {
      id: 'knowledge-document-sop-return-001',
      title: '退貨處理 SOP',
      sourceType: KnowledgeSourceType.sop,
      sourceKey: 'sop-return-process',
      version: '1.0.0',
      language: 'zh-TW',
      status: KnowledgeDocumentStatus.active,
      metadata: {
        domain: 'orders'
      },
      createdAt: new Date(baseDate),
      updatedAt: new Date(baseDate)
    },
    {
      id: 'knowledge-document-field-order-status-001',
      title: '訂單狀態欄位說明',
      sourceType: KnowledgeSourceType.field_guide,
      sourceKey: 'field-order-status',
      version: '1.0.0',
      language: 'zh-TW',
      status: KnowledgeDocumentStatus.active,
      metadata: {
        domain: 'orders'
      },
      createdAt: new Date(baseDate),
      updatedAt: new Date(baseDate)
    },
    {
      id: 'knowledge-document-archived-001',
      title: '封存文件',
      sourceType: KnowledgeSourceType.manual,
      sourceKey: 'archived-manual',
      version: '1.0.0',
      language: 'zh-TW',
      status: KnowledgeDocumentStatus.archived,
      metadata: null,
      createdAt: new Date(baseDate),
      updatedAt: new Date(baseDate)
    }
  ];
}

function createKnowledgeChunks(baseDate: Date): KnowledgeChunkRecord[] {
  return [
    {
      id: 'knowledge-chunk-sop-return-001',
      documentId: 'knowledge-document-sop-return-001',
      chunkIndex: 0,
      heading: '退貨流程',
      content: '退貨流程須先確認訂單狀態與收貨紀錄，再依 SOP 建立退貨申請；未完成收貨前不得直接退款。',
      tokenCount: 43,
      metadata: {
        sourceKey: 'sop-return-process'
      },
      embeddingRef: null,
      vectorId: null,
      enabled: true,
      createdAt: new Date(baseDate),
      updatedAt: new Date(baseDate)
    },
    {
      id: 'knowledge-chunk-field-order-status-001',
      documentId: 'knowledge-document-field-order-status-001',
      chunkIndex: 0,
      heading: 'status 欄位',
      content: 'status 欄位代表訂單目前處理階段，例如 draft、confirmed、shipped 或 cancelled；它不是庫存數量欄位。',
      tokenCount: 49,
      metadata: {
        sourceKey: 'field-order-status'
      },
      embeddingRef: null,
      vectorId: null,
      enabled: true,
      createdAt: new Date(baseDate),
      updatedAt: new Date(baseDate)
    },
    {
      id: 'knowledge-chunk-archived-001',
      documentId: 'knowledge-document-archived-001',
      chunkIndex: 0,
      heading: '封存',
      content: '這段封存內容不應被 retrieval 使用。',
      tokenCount: 15,
      metadata: null,
      embeddingRef: null,
      vectorId: null,
      enabled: true,
      createdAt: new Date(baseDate),
      updatedAt: new Date(baseDate)
    }
  ];
}

function createActionDrafts(baseDate: Date): ActionDraftRecord[] {
  const toolContract = {
    toolDefinitionId: 'tool-definition-orders-update-001',
    toolName: 'mock.orders.status.update',
    toolVersion: '1.0.0',
    operation: ToolOperation.update,
    riskLevel: RiskLevel.medium,
    hasSideEffect: true,
    requiresConfirmation: true,
    requiresApproval: false
  };
  const common = {
    requestId: 'req-us3-action-draft-fixture',
    sessionId: 'session-owned-001',
    messageId: 'message-owned-assistant-001',
    actorId: 'actor-001',
    toolName: 'mock.orders.status.update',
    resource: 'orders',
    operation: ToolOperation.update,
    riskLevel: RiskLevel.medium,
    payloadSummary: {
      resource: 'orders',
      entityType: 'order',
      entityId: 'SO-10001',
      toolContract
    },
    preview: {
      action: 'confirmation_required',
      resource: 'orders',
      entityType: 'order',
      entityId: 'SO-10001',
      operation: ToolOperation.update,
      toolContract
    },
    createdAt: new Date(baseDate),
    confirmedAt: null,
    executedAt: null
  };

  return [
    {
      ...common,
      id: 'action-draft-waiting-001',
      status: ActionDraftStatus.waiting_confirmation,
      idempotencyKey: null,
      expiresAt: new Date('2026-12-31T00:00:00.000Z')
    },
    {
      ...common,
      id: 'action-draft-draft-001',
      status: ActionDraftStatus.draft,
      idempotencyKey: null,
      expiresAt: new Date('2026-12-31T00:00:00.000Z')
    },
    {
      ...common,
      id: 'action-draft-expired-001',
      status: ActionDraftStatus.expired,
      idempotencyKey: null,
      expiresAt: new Date('2026-01-01T00:00:00.000Z')
    },
    {
      ...common,
      id: 'action-draft-cancelled-001',
      status: ActionDraftStatus.cancelled,
      idempotencyKey: null,
      expiresAt: new Date('2026-12-31T00:00:00.000Z')
    },
    {
      ...common,
      id: 'action-draft-executed-001',
      status: ActionDraftStatus.executed,
      idempotencyKey: 'idem-action-draft-executed-001',
      executedAt: new Date('2026-06-16T00:00:07.000Z'),
      expiresAt: new Date('2026-12-31T00:00:00.000Z')
    }
  ];
}

function createApprovalRequests(baseDate: Date): ApprovalRequestRecord[] {
  const toolContract = {
    toolDefinitionId: 'tool-definition-orders-cancel-001',
    toolName: 'mock.orders.cancel',
    toolVersion: '1.0.0',
    operation: ToolOperation.update,
    riskLevel: RiskLevel.high,
    hasSideEffect: true,
    requiresConfirmation: false,
    requiresApproval: true
  };
  const common = {
    requestId: 'req-us3-approval-fixture',
    sessionId: 'session-owned-001',
    messageId: 'message-owned-assistant-001',
    requesterActorId: 'actor-001',
    approverActorId: 'approver-001',
    riskLevel: RiskLevel.high,
    status: ApprovalRequestStatus.pending,
    actionSummary: {
      action: 'approval_required',
      toolName: 'mock.orders.cancel',
      toolDefinitionId: 'tool-definition-orders-cancel-001',
      toolVersion: '1.0.0',
      hasSideEffect: true,
      requiresConfirmation: false,
      requiresApproval: true,
      resource: 'orders',
      operation: ToolOperation.update,
      entityType: 'order',
      entityId: 'SO-10001',
      toolContract
    },
    payloadSummary: {
      resource: 'orders',
      entityType: 'order',
      entityId: 'SO-10001',
      riskLevel: RiskLevel.high,
      toolContract
    },
    evidenceRefIds: ['evidence-owned-001'],
    decisionReason: null,
    idempotencyKey: null,
    auditEventIds: [],
    expiresAt: new Date('2026-12-31T00:00:00.000Z'),
    createdAt: new Date(baseDate),
    decidedAt: null
  };

  return [
    {
      ...common,
      id: 'approval-request-pending-get-001'
    },
    {
      ...common,
      id: 'approval-request-pending-approve-001'
    },
    {
      ...common,
      id: 'approval-request-pending-denied-001'
    },
    {
      ...common,
      id: 'approval-request-pending-reject-001'
    },
    {
      ...common,
      id: 'approval-request-pending-cancel-001'
    }
  ];
}

function createEscalationRequests(baseDate: Date): EscalationRequestRecord[] {
  const common = {
    requestId: 'req-us3-escalation-fixture',
    sessionId: 'session-owned-001',
    messageId: 'message-owned-assistant-001',
    reason: EscalationReason.policy_required,
    ownerType: EscalationOwnerType.approver,
    summary: {
      riskLevel: RiskLevel.critical,
      reasonCode: EscalationReason.policy_required,
      reasonSummary: 'Critical-risk action requires manual escalation before any system side effect.',
      requesterActorId: 'actor-001',
      assignedActorId: null,
      status: EscalationStatus.open,
      actionSummary: {
        toolName: 'mock.orders.cancel',
        resource: 'orders',
        operation: ToolOperation.update,
        entityType: 'order',
        entityId: 'SO-10001'
      },
      contextSummary: {
        module: 'orders',
        entityType: 'order',
        entityId: 'SO-10001',
        visibleFieldCount: 2
      },
      expiresAt: '2026-12-31T00:00:00.000Z'
    },
    createdAt: new Date(baseDate),
    resolvedAt: null
  };

  return [
    {
      ...common,
      id: 'escalation-request-open-001',
      status: EscalationStatus.open
    },
    {
      ...common,
      id: 'escalation-request-resolved-001',
      status: EscalationStatus.resolved,
      summary: {
        ...common.summary,
        status: EscalationStatus.resolved,
        assignedActorId: 'approver-001',
        reasonProvided: true
      },
      resolvedAt: new Date('2026-06-16T00:00:08.000Z')
    },
    {
      ...common,
      id: 'escalation-request-cancelled-001',
      status: EscalationStatus.cancelled,
      summary: {
        ...common.summary,
        status: EscalationStatus.cancelled,
        reasonProvided: true
      },
      resolvedAt: new Date('2026-06-16T00:00:09.000Z')
    },
    {
      ...common,
      id: 'escalation-request-expired-001',
      status: EscalationStatus.expired,
      summary: {
        ...common.summary,
        status: EscalationStatus.expired,
        expiresAt: '2026-01-01T00:00:00.000Z'
      }
    },
    {
      ...common,
      id: 'escalation-request-hidden-actor-001',
      sessionId: 'session-hidden-001',
      status: EscalationStatus.open,
      summary: {
        ...common.summary,
        requesterActorId: 'actor-002',
        contextSummary: {
          module: 'orders',
          entityType: 'order',
          entityId: 'SO-20002',
          visibleFieldCount: 1
        }
      }
    }
  ];
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
      id: 'tool-definition-orders-update-001',
      name: 'mock.orders.status.update',
      description: 'Mock order status update side effect.',
      resource: 'orders',
      operation: ToolOperation.update,
      requiredPermissions: ['orders:update'],
      outputRequired: ['orderId', 'status'],
      riskLevel: RiskLevel.medium,
      hasSideEffect: true,
      requiresConfirmation: true,
      baseDate
    }),
    createToolDefinition({
      id: 'tool-definition-orders-cancel-001',
      name: 'mock.orders.cancel',
      description: 'Mock order cancellation side effect.',
      resource: 'orders',
      operation: ToolOperation.update,
      requiredPermissions: ['orders:approve'],
      outputRequired: ['orderId', 'status'],
      riskLevel: RiskLevel.high,
      hasSideEffect: true,
      requiresApproval: true,
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
  operation?: ToolOperation;
  requiredPermissions: string[];
  outputRequired: string[];
  riskLevel?: RiskLevel;
  hasSideEffect?: boolean;
  requiresConfirmation?: boolean;
  requiresApproval?: boolean;
  baseDate: Date;
}): ToolDefinitionRecord {
  return {
    id: input.id,
    name: input.name,
    version: '1.0.0',
    description: input.description,
    resource: input.resource,
    operation: input.operation ?? ToolOperation.read,
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
    riskLevel: input.riskLevel ?? RiskLevel.low,
    hasSideEffect: input.hasSideEffect ?? false,
    requiresConfirmation: input.requiresConfirmation ?? false,
    requiresApproval: input.requiresApproval ?? false,
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
  return new Date(Date.UTC(2026, 5, 16, 0, 0, 10 + mockTick));
}
