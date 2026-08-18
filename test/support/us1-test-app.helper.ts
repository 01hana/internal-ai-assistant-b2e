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
  KnowledgeVisibility,
  KnowledgeSourceType,
  ToolCallStatus,
  ToolExecutionStatus,
  ToolOperation,
  RetrievalStrategy
} from '../../src/generated/prisma/enums';
import { GlobalExceptionFilter } from '../../src/common/errors/global-exception.filter';
import { RequestIdInterceptor } from '../../src/common/request-id/request-id.interceptor';
import { ResponseEnvelopeInterceptor } from '../../src/common/response/response-envelope.interceptor';
import {
  DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE,
  InternalTokenClaims,
  TEST_BACKEND_AUDIENCE,
  TEST_GATEWAY_ISSUER,
  TestJwtFixture
} from './internal-identity-jwt.helper';
import {
  createInternalIdentityTestConfig,
  INTERNAL_IDENTITY_TEST_CONFIG,
  InternalIdentityTestConfig
} from './internal-identity-test-module.helper';
import { isValidNormalizedKnowledgeDocumentAccessPolicy } from '../../src/retrieval/knowledge-access-policy.types';

type SessionRecord = {
  id: string;
  customerId?: string;
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
  customerId?: string;
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
  customerId?: string;
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
  customerId?: string;
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

type CustomerToolPolicyRecord = {
  customerId: string;
  toolDefinitionId: string;
  enabled: boolean;
  requiredRoles: string[];
  requiredPermissionScopes: string[];
};

type ActionDraftRecord = {
  id: string;
  customerId: string;
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
  customerId: string;
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
  customerId: string;
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
  customerId: string;
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
  customerId: string;
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
  customerId?: string;
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
  customerId?: string;
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
  customerId?: string;
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
  customerId?: string;
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
  customerId: string;
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
  customerId: string;
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
  customerId: string;
  title: string;
  sourceType: KnowledgeSourceType;
  sourceKey: string;
  version: string;
  language: string;
  status: KnowledgeDocumentStatus;
  visibility: KnowledgeVisibility | string | null;
  organizationIds: unknown;
  requiredPermissionScopes: unknown;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
};

type KnowledgeChunkRecord = {
  id: string;
  customerId: string;
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
  customerId: string;
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
  customerId: string;
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
  customerId?: string;
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
  customerToolPolicies: CustomerToolPolicyRecord[];
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
  internalIdentity?: InternalIdentityTestConfig;
  workflowAuditFailureEventTypes: string[];
  orchestration: {
    sendMessage: jest.Mock;
    sseEventBuilds: jest.Mock;
  };
};

export type Us1TestState = MockState;

export type { InternalIdentityTestConfig } from './internal-identity-test-module.helper';

export type Us1TestAppOptions = {
  internalIdentity?: InternalIdentityTestConfig;
  /** Retains the production remote-JWKS verifier for transport-level identity tests. */
  internalIdentityVerifierMode?: 'static' | 'remote';
  forceMessageServiceErrorForSessionId?: string;
};

export async function createUs1TestAppWithState(
  options: Us1TestAppOptions = {}
): Promise<{ app: INestApplication; state: Us1TestState; prismaMock: ReturnType<typeof createPrismaMock> }> {
  process.env.DATABASE_URL = 'postgresql://assistant:assistant_dev_password@localhost:5432/assistant_dev';
  process.env.POSTGRES_USER = 'assistant';
  process.env.POSTGRES_PASSWORD = 'assistant_dev_password';
  process.env.POSTGRES_DB = 'assistant_dev';
  process.env.LLM_PROVIDER = 'openai';
  process.env.LLM_MODEL = 'local-placeholder-model';
  process.env.OPENAI_API_KEY = 'placeholder-openai-api-key';
  process.env.INTERNAL_IDENTITY_JWT_ISSUER = options.internalIdentity?.issuer ?? 'https://gateway.test.internal';
  process.env.INTERNAL_IDENTITY_JWT_AUDIENCE = options.internalIdentity?.audience ?? 'internal-assistant-core-test';
  process.env.INTERNAL_IDENTITY_JWKS_URI = options.internalIdentity?.jwksUri ?? 'https://gateway.test.internal/.well-known/jwks.json';
  process.env.ENABLE_SWAGGER_DOCS = 'false';
  process.env.SWAGGER_PATH = 'docs';

  const state = createInitialState();
  const prismaMock = createPrismaMock(state);
  const internalIdentity = createInternalIdentityTestConfig(options.internalIdentity ?? {
    issuer: TEST_GATEWAY_ISSUER,
    audience: TEST_BACKEND_AUDIENCE,
    jwks: DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE.jwks
  });

  const { AppModule } = await import('../../src/app.module');
  const { createStaticInternalIdentityTokenVerifier } = await import('../../src/identity/internal-identity-token-verifier');
  const { INTERNAL_IDENTITY_CONFIG, INTERNAL_IDENTITY_TOKEN_VERIFIER } = await import('../../src/identity/identity-token.types');
  const { PrismaService } = await import('../../src/prisma/prisma.service');
  const builder = Test.createTestingModule({
    imports: [AppModule],
    providers: [{ provide: INTERNAL_IDENTITY_TEST_CONFIG, useValue: internalIdentity }]
  })
    .overrideProvider(INTERNAL_IDENTITY_CONFIG)
    .useValue({
      issuer: internalIdentity.issuer,
      audience: internalIdentity.audience,
      jwksUri: process.env.INTERNAL_IDENTITY_JWKS_URI,
      clockToleranceSeconds: 0
    })
    .overrideProvider(PrismaService)
    .useValue({
      onModuleInit: jest.fn(),
      onModuleDestroy: jest.fn(),
      db: prismaMock
    });
  if (options.internalIdentityVerifierMode !== 'remote') {
    builder.overrideProvider(INTERNAL_IDENTITY_TOKEN_VERIFIER)
      .useValue(createStaticInternalIdentityTokenVerifier(internalIdentity));
  }
  const moduleRef = await builder.compile();

  const { AssistantMessageService } = await import('../../src/assistant/message/assistant-message.service');
  const { AssistantSseEventBuilder } = await import('../../src/assistant/sse/assistant-sse-event.builder');
  const assistantMessageService = moduleRef.get(AssistantMessageService);
  const originalSendMessage = assistantMessageService.sendMessage.bind(assistantMessageService);
  jest.spyOn(assistantMessageService, 'sendMessage').mockImplementation(async (input) => {
    state.orchestration.sendMessage(input);
    if (input.sessionId === options.forceMessageServiceErrorForSessionId) {
      throw new Error('test-only in-stream failure');
    }
    return originalSendMessage(input);
  });
  const sseEventBuilder = moduleRef.get(AssistantSseEventBuilder);
  const originalBuildMessageEvents = sseEventBuilder.buildMessageEvents.bind(sseEventBuilder);
  jest.spyOn(sseEventBuilder, 'buildMessageEvents').mockImplementation((input) => {
    state.orchestration.sseEventBuilds(input);
    return originalBuildMessageEvents(input);
  });

  state.internalIdentity = internalIdentity;

  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ forbidNonWhitelisted: true, transform: true, whitelist: true }));
  app.useGlobalInterceptors(new RequestIdInterceptor(), new ResponseEnvelopeInterceptor());
  app.useGlobalFilters(new GlobalExceptionFilter());
  await app.init();

  return { app, state, prismaMock };
}

export async function createUs1TestApp(): Promise<INestApplication> {
  const { app } = await createUs1TestAppWithState();
  return app;
}

export function createIdentityHeaders(overrides?: Partial<Record<string, string>>) {
  return {
    authorization: `Bearer ${DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE.sign()}`,
    'x-request-id': 'req-us1-default',
    'x-actor-id': 'actor-001',
    'x-host-app': 'erp',
    'x-organization-id': 'org-001',
    'x-role': 'planner',
    'x-permission-scopes': 'orders:read,inventory:read',
    ...overrides
  };
}

export function createAuthorizedInternalIdentityHeaders(
  fixture: TestJwtFixture,
  options: {
    claims?: Partial<InternalTokenClaims>;
    requestId?: string;
  } = {}
): Record<string, string> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${fixture.sign({ claims: options.claims })}`
  };

  if (options.requestId !== undefined) {
    headers['x-request-id'] = options.requestId;
  }

  return headers;
}

export function createLegacyPublicIdentityHeaders(
  overrides: Partial<Record<string, string>> = {}
): Record<string, string> {
  const nonAuthorizationOverrides = Object.fromEntries(
    Object.entries(overrides).filter(([name]) => name.toLowerCase() !== 'authorization')
  );

  return {
    'x-request-id': 'req-legacy-public-identity',
    'x-customer-id': 'customer-header',
    'x-actor-id': 'actor-header',
    'x-role': 'planner',
    'x-organization-id': 'org-header',
    'x-host-app': 'erp',
    'x-permission-scopes': 'orders:read',
    ...nonAuthorizationOverrides
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

export function createUs1PrismaMockForTest(state: Us1TestState) {
  return createPrismaMock(state);
}

export function createUs1TestStateForTest(): Us1TestState {
  return createInitialState();
}

function createPrismaMock(state: MockState) {
  const prismaMock: Record<string, any> = {
    $queryRaw: jest.fn(async (query: unknown, ...values: unknown[]) => {
      if (!isAuthorizedKnowledgeChunkQuery(query)) {
        return [{ result: 1 }];
      }

      const [customerId, documentCustomerId, status, organizationId, permissionScopes] = values;
      if (
        typeof customerId !== 'string' ||
        documentCustomerId !== customerId ||
        status !== KnowledgeDocumentStatus.active ||
        typeof organizationId !== 'string' ||
        !Array.isArray(permissionScopes) ||
        permissionScopes.some((scope) => typeof scope !== 'string')
      ) {
        return [];
      }

      return state.knowledgeChunks
        .filter((chunk) => chunk.customerId === customerId && chunk.enabled)
        .map((chunk) => ({ chunk, document: state.knowledgeDocuments.find((document) => document.id === chunk.documentId) }))
        .filter(({ document }) =>
          document?.customerId === customerId &&
          document.status === KnowledgeDocumentStatus.active &&
          isValidNormalizedKnowledgeDocumentAccessPolicy(document)
        )
        .filter(({ document }) =>
          document?.visibility === KnowledgeVisibility.CUSTOMER ||
          (document?.visibility === KnowledgeVisibility.ORGANIZATION &&
            Array.isArray(document.organizationIds) &&
            document.organizationIds.includes(organizationId))
        )
        .filter(({ document }) =>
          Array.isArray(document?.requiredPermissionScopes) &&
          document.requiredPermissionScopes.every((scope) => permissionScopes.includes(scope))
        )
        .sort((left, right) =>
          left.chunk.documentId.localeCompare(right.chunk.documentId) || left.chunk.chunkIndex - right.chunk.chunkIndex
        )
        .map(({ chunk, document }) => ({
          id: chunk.id,
          customerId: chunk.customerId,
          documentId: chunk.documentId,
          chunkIndex: chunk.chunkIndex,
          heading: chunk.heading,
          content: chunk.content,
          title: document!.title,
          sourceKey: document!.sourceKey
        }));
    }),
    assistantSession: {
      create: jest.fn(async ({ data }: { data: Partial<SessionRecord> }) => {
        const now = nextDate();
        const record: SessionRecord = {
          id: `session-created-${state.sessions.length + 1}`,
          customerId: data.customerId,
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
      findUnique: jest.fn(async ({ where }: { where: Record<string, unknown> }) => state.sessions.find((item) => matchesWhere(item, where)) ?? null),
      findFirst: jest.fn(
        async ({
          where
        }: {
          where: Record<string, unknown>;
        }) =>
          state.sessions.find((item) => matchesWhere(item, where)) ?? null
      ),
      findMany: jest.fn(async ({ where }: { where?: Record<string, unknown> } = {}) =>
        state.sessions.filter((item) => !where || matchesWhere(item, where))
      ),
      update: jest.fn(async ({ where, data }: { where: Record<string, unknown>; data: Partial<SessionRecord> }) => {
        const session = state.sessions.find((item) => matchesWhere(item, where));
        if (!session) throw new Error('AssistantSession not found.');
        Object.assign(session, data, { updatedAt: nextDate() });
        return session;
      }),
      updateMany: jest.fn(async ({ where, data }: { where: Record<string, unknown>; data: Partial<SessionRecord> }) => {
        const matches = state.sessions.filter((item) => matchesWhere(item, where));
        matches.forEach((item) => Object.assign(item, data, { updatedAt: nextDate() }));
        return { count: matches.length };
      }),
      delete: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const index = state.sessions.findIndex((item) => matchesWhere(item, where));
        if (index < 0) throw new Error('AssistantSession not found.');
        return state.sessions.splice(index, 1)[0];
      }),
      deleteMany: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const matches = state.sessions.filter((item) => matchesWhere(item, where));
        state.sessions.splice(0, state.sessions.length, ...state.sessions.filter((item) => !matches.includes(item)));
        return { count: matches.length };
      })
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
          customerId: data.customerId,
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
          where: Record<string, unknown>;
          orderBy?: { updatedAt: 'desc' | 'asc' };
        }) =>
          [...state.contextStates]
            .filter((item) => matchesWhere(item, where))
            .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())[0] ?? null
      ),
      upsert: jest.fn(async ({ where, create, update }: { where: Record<string, unknown>; create: Partial<ContextStateRecord>; update: Partial<ContextStateRecord> }) => {
        const existing = state.contextStates.find((item) => matchesWhere(item, where));
        if (existing) {
          Object.assign(existing, update, { updatedAt: nextDate() });
          return existing;
        }

        const record = {
          id: `context-${state.contextStates.length + 1}`,
          customerId: create.customerId,
          sessionId: create.sessionId ?? 'session-owned-001',
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
      updateMany: jest.fn(async ({ where, data }: { where: Record<string, unknown>; data: Partial<ContextStateRecord> }) => {
        const matching = state.contextStates.filter((item) => matchesWhere(item, where));
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
          customerId: data.customerId,
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
          where: Record<string, unknown>;
          orderBy?: { createdAt: 'asc' | 'desc' };
          take?: number;
          cursor?: { id: string };
          skip?: number;
        }) => {
        const sorted = [...state.messages]
          .filter((item) => matchesWhere(item, where))
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
      update: jest.fn(async ({ where, data }: { where: Record<string, unknown>; data: Partial<MessageRecord> }) => {
        const message = state.messages.find((item) => matchesWhere(item, where));
        if (!message) {
          throw new Error(`Message ${where.id} not found.`);
        }

        Object.assign(message, data);
        return message;
      }),
      findUnique: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
        state.messages.find((item) => matchesWhere(item, where)) ?? null
      ),
      findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
        state.messages.find((item) => matchesWhere(item, where)) ?? null
      ),
      updateMany: jest.fn(async ({ where, data }: { where: Record<string, unknown>; data: Partial<MessageRecord> }) => {
        const matching = state.messages.filter((item) => matchesWhere(item, where));
        matching.forEach((item) => Object.assign(item, data));
        return { count: matching.length };
      })
    },
    queryUnderstandingResult: {
      upsert: jest.fn(async ({ where, create, update }: { where: Record<string, unknown>; create: Partial<QueryUnderstandingRecord>; update: Partial<QueryUnderstandingRecord> }) => {
        const existing = state.queryUnderstandingResults.find((item) => matchesWhere(item, where));
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }

        const record: QueryUnderstandingRecord = {
          id: `qu-${state.queryUnderstandingResults.length + 1}`,
          customerId: create.customerId,
          requestId: create.requestId ?? 'req-generated',
          messageId: create.messageId ?? 'message-generated',
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
          customerId: data.customerId,
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
          customerId: requireCustomerId(data.customerId, 'ActionDraft'),
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
      findUnique: jest.fn(async ({ where }: { where: Record<string, unknown> }) => state.actionDrafts.find((item) => matchesWhere(item, where)) ?? null),
      findFirst: jest.fn(
        async ({
          where
        }: {
          where: Record<string, unknown>;
        }) =>
          state.actionDrafts.find((item) => matchesWhere(item, where)) ?? null
      ),
      findMany: jest.fn(
        async ({
          where
        }: {
          where?: Record<string, unknown>;
        } = {}) =>
          state.actionDrafts.filter((item) => !where || matchesWhere(item, where))
      ),
      update: jest.fn(async ({ where, data }: { where: Record<string, unknown>; data: Partial<ActionDraftRecord> }) => {
        const draft = state.actionDrafts.find((item) => matchesWhere(item, where));
        if (!draft) {
          throw new Error('ActionDraft not found.');
        }

        Object.assign(draft, data);
        return draft;
      }),
      updateMany: jest.fn(async ({ where, data }: { where: Record<string, unknown>; data: Partial<ActionDraftRecord> }) => {
        const records = state.actionDrafts.filter((item) => matchesWhere(item, where));
        records.forEach((record) => Object.assign(record, data));
        return { count: records.length };
      })
    },
    approvalRequest: {
      create: jest.fn(async ({ data }: { data: Partial<ApprovalRequestRecord> }) => {
        const record: ApprovalRequestRecord = {
          id: `approval-request-created-${state.approvalRequests.length + 1}`,
          customerId: requireCustomerId(data.customerId, 'ApprovalRequest'),
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
      findUnique: jest.fn(async ({ where }: { where: Record<string, unknown> }) => state.approvalRequests.find((item) => matchesWhere(item, where)) ?? null),
      findFirst: jest.fn(
        async ({
          where
        }: {
          where: Record<string, unknown>;
        }) =>
          state.approvalRequests.find((item) => matchesWhere(item, where)) ?? null
      ),
      findMany: jest.fn(
        async ({
          where,
          orderBy
        }: {
          where?: Record<string, unknown>;
          orderBy?: { createdAt: 'asc' | 'desc' };
        } = {}) =>
          state.approvalRequests
            .filter((item) => !where || matchesWhere(item, where))
            .sort((left, right) =>
              (orderBy?.createdAt ?? 'desc') === 'desc'
                ? right.createdAt.getTime() - left.createdAt.getTime()
                : left.createdAt.getTime() - right.createdAt.getTime()
            )
      ),
      update: jest.fn(async ({ where, data }: { where: Record<string, unknown>; data: Partial<ApprovalRequestRecord> }) => {
        const approvalRequest = state.approvalRequests.find((item) => matchesWhere(item, where));
        if (!approvalRequest) {
          throw new Error('ApprovalRequest not found.');
        }

        Object.assign(approvalRequest, data);
        return approvalRequest;
      }),
      updateMany: jest.fn(async ({ where, data }: { where: Record<string, unknown>; data: Partial<ApprovalRequestRecord> }) => {
        const records = state.approvalRequests.filter((item) => matchesWhere(item, where));
        records.forEach((record) => Object.assign(record, data));
        return { count: records.length };
      }),
      delete: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const index = state.approvalRequests.findIndex((item) => matchesWhere(item, where));
        if (index < 0) {
          throw new Error('ApprovalRequest not found.');
        }

        return state.approvalRequests.splice(index, 1)[0];
      })
    },
    escalationRequest: {
      create: jest.fn(async ({ data }: { data: Partial<EscalationRequestRecord> }) => {
        const record: EscalationRequestRecord = {
          id: `escalation-request-created-${state.escalationRequests.length + 1}`,
          customerId: requireCustomerId(data.customerId, 'EscalationRequest'),
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
      findUnique: jest.fn(async ({ where }: { where: Record<string, unknown> }) => state.escalationRequests.find((item) => matchesWhere(item, where)) ?? null),
      findFirst: jest.fn(
        async ({
          where
        }: {
          where: Record<string, unknown>;
        }) =>
          state.escalationRequests.find((item) => matchesWhere(item, where)) ?? null
      ),
      findMany: jest.fn(
        async ({
          where,
          orderBy
        }: {
          where?: Record<string, unknown>;
          orderBy?: { createdAt: 'asc' | 'desc' };
        } = {}) =>
          state.escalationRequests
            .filter((item) => !where || matchesWhere(item, where))
            .sort((left, right) =>
              (orderBy?.createdAt ?? 'desc') === 'desc'
                ? right.createdAt.getTime() - left.createdAt.getTime()
                : left.createdAt.getTime() - right.createdAt.getTime()
            )
      ),
      update: jest.fn(async ({ where, data }: { where: Record<string, unknown>; data: Partial<EscalationRequestRecord> }) => {
        const escalationRequest = state.escalationRequests.find((item) => matchesWhere(item, where));
        if (!escalationRequest) {
          throw new Error('EscalationRequest not found.');
        }

        Object.assign(escalationRequest, data);
        return escalationRequest;
      }),
      updateMany: jest.fn(async ({ where, data }: { where: Record<string, unknown>; data: Partial<EscalationRequestRecord> }) => {
        const records = state.escalationRequests.filter((item) => matchesWhere(item, where));
        records.forEach((record) => Object.assign(record, data));
        return { count: records.length };
      })
    },
    toolCall: {
      create: jest.fn(async ({ data }: { data: Partial<ToolCallRecord> }) => {
        const record: ToolCallRecord = {
          id: `tool-call-${state.toolCalls.length + 1}`,
          customerId: data.customerId,
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
      update: jest.fn(async ({ where, data }: { where: Record<string, unknown>; data: Partial<ToolCallRecord> }) => {
        const toolCall = state.toolCalls.find((item) => matchesWhere(item, where));
        if (!toolCall) {
          throw new Error(`ToolCall ${where.id} not found.`);
        }

        Object.assign(toolCall, data);
        return toolCall;
      }),
      updateMany: jest.fn(async ({ where, data }: { where: Record<string, unknown>; data: Partial<ToolCallRecord> }) => {
        const matches = state.toolCalls.filter((item) => matchesWhere(item, where));
        matches.forEach((item) => Object.assign(item, data));
        return { count: matches.length };
      }),
      findMany: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
        state.toolCalls
          .filter((item) => matchesWhere(item, where))
          .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
      ),
      findFirst: jest.fn(
        async ({ where }: { where: Record<string, unknown> }) => state.toolCalls.find((item) => matchesWhere(item, where)) ?? null
      )
    },
    customerToolPolicy: {
      findUnique: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const selector = where.customerId_toolDefinitionId;
        if (!isRecord(selector)) return null;
        return state.customerToolPolicies.find(
          (item) => item.customerId === selector.customerId && item.toolDefinitionId === selector.toolDefinitionId
        ) ?? null;
      }),
      findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
        state.customerToolPolicies.find((item) => matchesWhere(item, where)) ?? null
      )
    },
    evidenceRef: {
      create: jest.fn(async ({ data }: { data: Partial<EvidenceRefRecord> }) => {
        const record: EvidenceRefRecord = {
          id: `evidence-${state.evidenceRefs.length + 1}`,
          customerId: requireCustomerId(data.customerId, 'EvidenceRef'),
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
      findMany: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
        state.evidenceRefs
          .filter((item) => matchesWhere(item, where))
          .sort((left, right) => left.timestamp.getTime() - right.timestamp.getTime())
      )
    },
    auditEvent: {
      create: jest.fn(async ({ data }: { data: Partial<AuditEventRecord> }) => {
        const failureIndex = state.workflowAuditFailureEventTypes.indexOf(data.eventType ?? '');
        if (failureIndex >= 0) {
          state.workflowAuditFailureEventTypes.splice(failureIndex, 1);
          throw new Error(`test-only workflow audit failure: ${data.eventType}`);
        }
        const record: AuditEventRecord = {
          id: `audit-${state.auditEvents.length + 1}`,
          customerId: requireCustomerId(data.customerId, 'AuditEvent'),
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
      }),
      findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
        state.auditEvents.find((item) => matchesWhere(item, where)) ?? null
      ),
      findMany: jest.fn(async ({ where }: { where?: Record<string, unknown> } = {}) =>
        state.auditEvents.filter((item) => !where || matchesWhere(item, where))
      ),
      updateMany: jest.fn(async ({ where, data }: { where: Record<string, unknown>; data: Partial<AuditEventRecord> }) => {
        const records = state.auditEvents.filter((item) => matchesWhere(item, where));
        records.forEach((record) => Object.assign(record, data));
        return { count: records.length };
      })
    },
    groundingCheck: {
      create: jest.fn(async ({ data }: { data: Partial<GroundingCheckRecord> }) => {
        const record: GroundingCheckRecord = {
          id: `grounding-${state.groundingChecks.length + 1}`,
          customerId: data.customerId,
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
          customerId: data.customerId,
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
      }),
      findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
        state.answerDecisions.find((item) => matchesWhere(item, where)) ?? null
      )
    },
    clarificationQuestion: {
      create: jest.fn(async ({ data }: { data: Partial<ClarificationQuestionRecord> }) => {
        const record: ClarificationQuestionRecord = {
          id: `clarification-question-${state.clarificationQuestions.length + 1}`,
          customerId: data.customerId,
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
          customerId: requireCustomerId(data.customerId, 'ReviewItem'),
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
      findMany: jest.fn(async ({ where }: { where?: Record<string, unknown> } = {}) =>
        state.reviewItems.filter((item) => !where || matchesWhere(item, where))
      ),
      findFirst: jest.fn(async ({ where }: { where?: Record<string, unknown> } = {}) =>
        state.reviewItems.find((item) => !where || matchesWhere(item, where)) ?? null
      ),
      findUnique: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
        state.reviewItems.find((item) => matchesWhere(item, where)) ?? null
      ),
      update: jest.fn(async ({ where, data }: { where: Record<string, unknown>; data: Partial<ReviewItemRecord> }) => {
        const reviewItem = state.reviewItems.find((item) => matchesWhere(item, where));
        if (!reviewItem) {
          throw new Error(`ReviewItem ${where.id} not found.`);
        }

        Object.assign(reviewItem, data);
        return reviewItem;
      }),
      updateMany: jest.fn(async ({ where, data }: { where: Record<string, unknown>; data: Partial<ReviewItemRecord> }) => {
        const records = state.reviewItems.filter((item) => matchesWhere(item, where));
        records.forEach((record) => Object.assign(record, data));
        return { count: records.length };
      })
    },
    feedbackEvent: {
      create: jest.fn(async ({ data }: { data: Partial<FeedbackEventRecord> }) => {
        const record: FeedbackEventRecord = {
          id: `feedback-event-${state.feedbackEvents.length + 1}`,
          customerId: requireCustomerId(data.customerId, 'FeedbackEvent'),
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
      findMany: jest.fn(async ({ where }: { where?: Record<string, unknown> } = {}) =>
        state.feedbackEvents.filter((item) => !where || matchesWhere(item, where))
      ),
      findFirst: jest.fn(async ({ where }: { where?: Record<string, unknown> } = {}) =>
        state.feedbackEvents.find((item) => !where || matchesWhere(item, where)) ?? null
      ),
      updateMany: jest.fn(async ({ where, data }: { where: Record<string, unknown>; data: Partial<FeedbackEventRecord> }) => {
        const records = state.feedbackEvents.filter((item) => matchesWhere(item, where));
        records.forEach((record) => Object.assign(record, data));
        return { count: records.length };
      })
    },
    knowledgeDocument: {
      findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
        state.knowledgeDocuments.find((item) => matchesWhere(item, where)) ?? null
      ),
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
          customerId: requireCustomerId(data.customerId, 'KnowledgeDocument'),
          title: data.title ?? 'Knowledge document',
          sourceType: (data.sourceType as KnowledgeSourceType | undefined) ?? KnowledgeSourceType.sop,
          sourceKey: data.sourceKey ?? `knowledge-source-${state.knowledgeDocuments.length + 1}`,
          version: data.version ?? '1.0.0',
          language: data.language ?? 'zh-TW',
          status: (data.status as KnowledgeDocumentStatus | undefined) ?? KnowledgeDocumentStatus.active,
          visibility: (data.visibility as KnowledgeVisibility | undefined) ?? KnowledgeVisibility.CUSTOMER,
          organizationIds: (data.organizationIds as string[] | undefined) ?? [],
          requiredPermissionScopes: (data.requiredPermissionScopes as string[] | undefined) ?? [],
          metadata: data.metadata ?? null,
          createdAt: nextDate(),
          updatedAt: nextDate()
        };
        state.knowledgeDocuments.push(record);
        return record;
      })
    },
    knowledgeChunk: {
      findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
        state.knowledgeChunks.find((item) => matchesWhere(item, where)) ?? null
      ),
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
          customerId: requireCustomerId(data.customerId, 'KnowledgeChunk'),
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
          customerId: requireCustomerId(data.customerId, 'RetrievalRun'),
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
      updateMany: jest.fn(async ({ where, data }: { where: Record<string, unknown>; data: Partial<RetrievalRunRecord> }) => {
        const records = state.retrievalRuns.filter((item) => matchesWhere(item, where));
        records.forEach((record) => Object.assign(record, data));
        return { count: records.length };
      }),
      findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
        state.retrievalRuns.find((item) => matchesWhere(item, where)) ?? null
      ),
      findMany: jest.fn(async ({ where }: { where?: Record<string, unknown> } = {}) =>
        state.retrievalRuns.filter((item) => !where || matchesWhere(item, where))
      )
    },
    retrievalCandidate: {
      create: jest.fn(async ({ data }: { data: Partial<RetrievalCandidateRecord> }) => {
        const record: RetrievalCandidateRecord = {
          id: `retrieval-candidate-${state.retrievalCandidates.length + 1}`,
          customerId: requireCustomerId(data.customerId, 'RetrievalCandidate'),
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
      findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
        state.retrievalCandidates.find((item) => matchesWhere(item, where)) ?? null
      ),
      findMany: jest.fn(async ({ where }: { where?: Record<string, unknown> } = {}) =>
        state.retrievalCandidates.filter((item) => !where || matchesWhere(item, where))
      )
    }
  };
  prismaMock.$transaction = jest.fn(async (callback: (transaction: Record<string, any>) => Promise<unknown>) => {
    const snapshot = structuredClone({
      sessions: state.sessions,
      messages: state.messages,
      approvalRequests: state.approvalRequests,
      actionDrafts: state.actionDrafts,
      escalationRequests: state.escalationRequests,
      feedbackEvents: state.feedbackEvents,
      reviewItems: state.reviewItems,
      evidenceRefs: state.evidenceRefs,
      auditEvents: state.auditEvents,
      toolCalls: state.toolCalls
    });
    try {
      return await callback(prismaMock);
    } catch (error) {
      restoreStateArray(state.sessions, snapshot.sessions);
      restoreStateArray(state.messages, snapshot.messages);
      restoreStateArray(state.approvalRequests, snapshot.approvalRequests);
      restoreStateArray(state.actionDrafts, snapshot.actionDrafts);
      restoreStateArray(state.escalationRequests, snapshot.escalationRequests);
      restoreStateArray(state.feedbackEvents, snapshot.feedbackEvents);
      restoreStateArray(state.reviewItems, snapshot.reviewItems);
      restoreStateArray(state.evidenceRefs, snapshot.evidenceRefs);
      restoreStateArray(state.auditEvents, snapshot.auditEvents);
      restoreStateArray(state.toolCalls, snapshot.toolCalls);
      throw error;
    }
  });
  return prismaMock;
}

function restoreStateArray(target: unknown[], snapshot: unknown[]) {
  target.splice(0, target.length, ...snapshot);
}

function isAuthorizedKnowledgeChunkQuery(query: unknown): boolean {
  return Array.isArray(query) && query.join('').includes('FROM "KnowledgeChunk" AS chunk');
}

function createInitialState(): MockState {
  const baseDate = new Date('2026-06-16T00:00:00.000Z');
  return {
    sessions: [
      {
        id: 'session-owned-001',
        customerId: 'customer-a',
        hostApp: 'erp',
        organizationId: 'org-shared',
        actorId: 'actor-shared',
        status: AssistantSessionStatus.active,
        createdAt: new Date(baseDate),
        updatedAt: new Date('2026-06-16T00:00:04.000Z'),
        lastMessageAt: new Date('2026-06-16T00:00:04.000Z')
      },
      {
        id: 'session-hidden-001',
        customerId: 'customer-b',
        hostApp: 'erp',
        organizationId: 'org-shared',
        actorId: 'actor-shared',
        status: AssistantSessionStatus.active,
        createdAt: new Date(baseDate),
        updatedAt: new Date('2026-06-16T00:00:01.000Z'),
        lastMessageAt: new Date('2026-06-16T00:00:01.000Z')
      },
      {
        id: 'session-closed-001',
        customerId: 'customer-a',
        hostApp: 'erp',
        organizationId: 'org-shared',
        actorId: 'actor-shared',
        status: AssistantSessionStatus.closed,
        createdAt: new Date(baseDate),
        updatedAt: new Date('2026-06-16T00:00:05.000Z'),
        lastMessageAt: new Date('2026-06-16T00:00:05.000Z')
      },
      {
        id: 'session-expired-001',
        customerId: 'customer-a',
        hostApp: 'erp',
        organizationId: 'org-shared',
        actorId: 'actor-shared',
        status: AssistantSessionStatus.expired,
        createdAt: new Date(baseDate),
        updatedAt: new Date('2026-06-16T00:00:06.000Z'),
        lastMessageAt: new Date('2026-06-16T00:00:06.000Z')
      },
      {
        id: 'session-flow-error-001',
        customerId: 'customer-a',
        hostApp: 'erp',
        organizationId: 'org-shared',
        actorId: 'actor-shared',
        status: AssistantSessionStatus.active,
        createdAt: new Date(baseDate),
        updatedAt: new Date('2026-06-16T00:00:07.000Z'),
        lastMessageAt: null
      }
    ],
    contextStates: [
      {
        id: 'context-owned-001',
        customerId: 'customer-a',
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
        customerId: 'customer-b',
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
        customerId: 'customer-a',
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
        customerId: 'customer-a',
        sessionId: 'session-owned-001',
        requestId: 'req-history-seed-001',
        role: AssistantMessageRole.assistant,
        content: '這張訂單目前狀態為已確認，客戶名稱是王小明企業。',
        answerDecision: 'answered',
        pageContext: null,
        createdAt: new Date('2026-06-16T00:00:04.000Z')
      },
      {
        id: 'message-hidden-user-001',
        customerId: 'customer-b',
        sessionId: 'session-hidden-001',
        requestId: 'req-history-seed-hidden-001',
        role: AssistantMessageRole.user,
        content: 'Customer B private message.',
        answerDecision: null,
        pageContext: null,
        createdAt: new Date('2026-06-16T00:00:02.000Z')
      },
      {
        id: 'message-hidden-assistant-001',
        customerId: 'customer-b',
        sessionId: 'session-hidden-001',
        requestId: 'req-history-seed-hidden-001',
        role: AssistantMessageRole.assistant,
        content: 'Customer B private answer.',
        answerDecision: 'answered',
        pageContext: null,
        createdAt: new Date('2026-06-16T00:00:04.000Z')
      }
    ],
    toolDefinitions: createToolDefinitions(baseDate),
    customerToolPolicies: [
      {
        customerId: 'customer-a',
        toolDefinitionId: 'tool-definition-orders-001',
        enabled: true,
        requiredRoles: [],
        requiredPermissionScopes: []
      },
      {
        customerId: 'customer-b',
        toolDefinitionId: 'tool-definition-orders-001',
        enabled: false,
        requiredRoles: [],
        requiredPermissionScopes: []
      },
      ...['tool-definition-orders-update-001', 'tool-definition-orders-cancel-001'].flatMap((toolDefinitionId) => [
        {
          customerId: 'customer-a',
          toolDefinitionId,
          enabled: true,
          requiredRoles: [],
          requiredPermissionScopes: []
        },
        {
          customerId: 'customer-b',
          toolDefinitionId,
          enabled: true,
          requiredRoles: [],
          requiredPermissionScopes: []
        }
      ])
    ],
    actionDrafts: createActionDrafts(baseDate),
    approvalRequests: createApprovalRequests(baseDate),
    escalationRequests: createEscalationRequests(baseDate),
    toolCalls: [
      {
        id: 'tool-call-owned-001',
        customerId: 'customer-a',
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
      },
      {
        id: 'tool-call-hidden-001',
        customerId: 'customer-b',
        requestId: 'req-history-seed-hidden-001',
        sessionId: 'session-hidden-001',
        messageId: 'message-hidden-assistant-001',
        toolDefinitionId: 'tool-definition-orders-001',
        toolName: 'mock.orders.status.lookup',
        toolVersion: '1.0.0',
        inputSummary: { entityId: 'SO-20002' },
        permissionResult: { scopes: ['orders:read'] },
        outputSummary: { status: 'private' },
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
        customerId: 'customer-a',
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
      },
      {
        id: 'evidence-hidden-001',
        customerId: 'customer-b',
        requestId: 'req-history-seed-hidden-001',
        messageId: 'message-hidden-assistant-001',
        sourceType: EvidenceSourceType.structured_record,
        sourceId: 'SO-20002',
        toolCallId: 'tool-call-hidden-001',
        documentId: null,
        chunkId: null,
        entityType: 'order',
        entityId: 'SO-20002',
        fieldPaths: ['status'],
        timestamp: new Date('2026-06-16T00:00:03.500Z'),
        permissionSnapshot: { visibleFields: ['status'] },
        summary: { fields: { status: 'private' } }
      }
    ],
    auditEvents: [],
    workflowAuditFailureEventTypes: [],
    queryUnderstandingResults: [],
    executionPlans: [],
    groundingChecks: [],
    answerDecisions: [],
    clarificationQuestions: [],
    reviewItems: createReviewItems(baseDate),
    feedbackEvents: [
      {
        id: 'feedback-event-seed-001', customerId: 'customer-a', requestId: 'workflow-shared-idempotency-key', messageId: 'message-owned-assistant-001', rating: FeedbackRating.negative, reason: null, comment: null, intent: 'not_helpful', toolCallIds: ['tool-call-owned-001'], evidenceRefIds: ['evidence-owned-001'], answerDecision: 'answered', createdAt: new Date(baseDate)
      },
      {
        id: 'feedback-event-hidden-001', customerId: 'customer-b', requestId: 'workflow-shared-idempotency-key', messageId: 'message-hidden-assistant-001', rating: FeedbackRating.negative, reason: null, comment: null, intent: 'not_helpful', toolCallIds: ['tool-call-hidden-001'], evidenceRefIds: ['evidence-hidden-001'], answerDecision: 'answered', createdAt: new Date(baseDate)
      }
    ],
    knowledgeDocuments: createKnowledgeDocuments(baseDate),
    knowledgeChunks: createKnowledgeChunks(baseDate),
    retrievalRuns: [],
    retrievalCandidates: [],
    orchestration: {
      sendMessage: jest.fn(),
      sseEventBuilds: jest.fn()
    }
  };
}

/**
 * The in-memory delegates intentionally apply only predicates supplied by the
 * runtime. They never synthesize a Customer predicate, so an unscoped query
 * remains observable as an expected-red Customer isolation failure.
 */
/**
 * Test delegates deliberately implement only explicit Prisma-style predicates.
 * They never add a Customer condition or infer one from a parent, organization,
 * actor, HostApp, request, or fixture.
 */
function matchesWhere(record: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => {
    // A supplied undefined value is an invalid predicate, never a wildcard.
    // Absence of the key remains observable as the legacy bare-ID behavior.
    if (value === undefined) return false;

    if (key === 'AND') {
      return Array.isArray(value) && value.every((predicate) => isRecord(predicate) && matchesWhere(record, predicate));
    }

    const compound = compoundSelectorFields(key, value);
    if (compound) {
      return compound.every(([field, expected]) => record[field] === expected);
    }

    if (key.startsWith('customerId_')) {
      return false;
    }

    if (isRecord(value)) {
      if (Array.isArray(value.in)) return value.in.includes(record[key]);
      if (value.gte instanceof Date || value.lte instanceof Date) {
        const actual = record[key];
        if (!(actual instanceof Date)) return false;
        return (
          (!(value.gte instanceof Date) || actual.getTime() >= value.gte.getTime()) &&
          (!(value.lte instanceof Date) || actual.getTime() <= value.lte.getTime())
        );
      }
      return false;
    }

    return record[key] === value;
  });
}

function compoundSelectorFields(
  key: string,
  value: unknown
): Array<[string, unknown]> | undefined {
  if (!isRecord(value)) return undefined;

  const expectedFields: Record<string, readonly string[]> = {
    customerId_id: ['customerId', 'id'],
    customerId_sessionId: ['customerId', 'sessionId'],
    customerId_messageId: ['customerId', 'messageId']
  };
  const fields = expectedFields[key];
  if (!fields || Object.keys(value).some((field) => !fields.includes(field))) return undefined;
  if (fields.some((field) => !(field in value) || value[field] === undefined)) return undefined;
  return fields.map((field) => [field, value[field]]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireCustomerId(value: unknown, model: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${model}.customerId must be provided by production data.`);
  }
  return value;
}

function createReviewItems(baseDate: Date): ReviewItemRecord[] {
  return [
    {
      id: 'review-item-open-feedback-001',
      customerId: 'customer-a',
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
      customerId: 'customer-b',
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
      customerId: 'customer-a',
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
    },
    {
      id: 'review-item-customer-a-shared-001',
      customerId: 'customer-a',
      sourceType: ReviewSourceType.negative_feedback,
      sourceId: 'feedback-event-seed-001',
      status: ReviewItemStatus.open,
      priority: ReviewPriority.medium,
      summary: 'customer-a review with shared lower-level fields',
      suggestedImprovement: {
        organizationId: 'org-shared',
        hostApp: 'erp',
        requestId: 'workflow-shared-idempotency-key',
        messageId: 'message-owned-assistant-001',
        feedbackEventId: 'feedback-event-seed-001',
        rating: 'negative',
        intent: 'not_helpful'
      },
      createdAt: new Date(baseDate),
      resolvedAt: null
    },
    {
      id: 'review-item-customer-b-shared-001',
      customerId: 'customer-b',
      sourceType: ReviewSourceType.negative_feedback,
      sourceId: 'feedback-event-seed-001',
      status: ReviewItemStatus.open,
      priority: ReviewPriority.medium,
      summary: 'customer-b review with shared lower-level fields',
      suggestedImprovement: {
        organizationId: 'org-shared',
        hostApp: 'erp',
        requestId: 'workflow-shared-idempotency-key',
        messageId: 'message-hidden-assistant-001',
        feedbackEventId: 'feedback-event-seed-001',
        rating: 'negative',
        intent: 'not_helpful'
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
      customerId: 'customer-a',
      title: '退貨處理 SOP',
      sourceType: KnowledgeSourceType.sop,
      sourceKey: 'sop-return-process',
      version: '1.0.0',
      language: 'zh-TW',
      status: KnowledgeDocumentStatus.active,
      visibility: KnowledgeVisibility.CUSTOMER,
      organizationIds: [],
      requiredPermissionScopes: [],
      metadata: {
        domain: 'orders'
      },
      createdAt: new Date(baseDate),
      updatedAt: new Date(baseDate)
    },
    {
      id: 'knowledge-document-field-order-status-001',
      customerId: 'customer-a',
      title: '訂單狀態欄位說明',
      sourceType: KnowledgeSourceType.field_guide,
      sourceKey: 'field-order-status',
      version: '1.0.0',
      language: 'zh-TW',
      status: KnowledgeDocumentStatus.active,
      visibility: KnowledgeVisibility.CUSTOMER,
      organizationIds: [],
      requiredPermissionScopes: [],
      metadata: {
        domain: 'orders'
      },
      createdAt: new Date(baseDate),
      updatedAt: new Date(baseDate)
    },
    {
      id: 'knowledge-document-archived-001',
      customerId: 'customer-a',
      title: '封存文件',
      sourceType: KnowledgeSourceType.manual,
      sourceKey: 'archived-manual',
      version: '1.0.0',
      language: 'zh-TW',
      status: KnowledgeDocumentStatus.archived,
      visibility: KnowledgeVisibility.CUSTOMER,
      organizationIds: [],
      requiredPermissionScopes: [],
      metadata: null,
      createdAt: new Date(baseDate),
      updatedAt: new Date(baseDate)
    },
    {
      id: 'knowledge-document-customer-a-return-001',
      customerId: 'customer-a',
      title: 'Shared Return SOP',
      sourceType: KnowledgeSourceType.sop,
      sourceKey: 'shared-return-sop',
      version: '1.0.0',
      language: 'en',
      status: KnowledgeDocumentStatus.active,
      visibility: KnowledgeVisibility.CUSTOMER,
      organizationIds: [],
      requiredPermissionScopes: [],
      metadata: { fixture: 'customer-a-own-match' },
      createdAt: new Date(baseDate),
      updatedAt: new Date(baseDate)
    },
    {
      id: 'knowledge-document-customer-b-return-001',
      customerId: 'customer-b',
      title: 'Shared Return SOP',
      sourceType: KnowledgeSourceType.sop,
      sourceKey: 'shared-return-sop',
      version: '1.0.0',
      language: 'en',
      status: KnowledgeDocumentStatus.active,
      visibility: KnowledgeVisibility.CUSTOMER,
      organizationIds: [],
      requiredPermissionScopes: [],
      metadata: { fixture: 'customer-b-own-match' },
      createdAt: new Date(baseDate),
      updatedAt: new Date(baseDate)
    },
    {
      id: 'knowledge-document-customer-b-foreign-only-001',
      customerId: 'customer-b',
      title: 'Foreign-only Return SOP',
      sourceType: KnowledgeSourceType.sop,
      sourceKey: 'customer-b-foreign-only-return-sop',
      version: '1.0.0',
      language: 'en',
      status: KnowledgeDocumentStatus.active,
      visibility: KnowledgeVisibility.CUSTOMER,
      organizationIds: [],
      requiredPermissionScopes: [],
      metadata: { fixture: 'customer-b-foreign-only' },
      createdAt: new Date(baseDate),
      updatedAt: new Date(baseDate)
    }
  ];
}

function createKnowledgeChunks(baseDate: Date): KnowledgeChunkRecord[] {
  return [
    {
      id: 'knowledge-chunk-sop-return-001',
      customerId: 'customer-a',
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
      customerId: 'customer-a',
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
      customerId: 'customer-a',
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
    },
    {
      id: 'knowledge-chunk-customer-a-return-001',
      customerId: 'customer-a',
      documentId: 'knowledge-document-customer-a-return-001',
      chunkIndex: 0,
      heading: 'Shared Return SOP',
      content: 'shared return SOP policy CUSTOMER_A_RETURN_RULE',
      tokenCount: 6,
      metadata: { fixture: 'customer-a-own-match' },
      embeddingRef: null,
      vectorId: null,
      enabled: true,
      createdAt: new Date(baseDate),
      updatedAt: new Date(baseDate)
    },
    {
      id: 'knowledge-chunk-customer-b-return-001',
      customerId: 'customer-b',
      documentId: 'knowledge-document-customer-b-return-001',
      chunkIndex: 0,
      heading: 'Shared Return SOP',
      content: 'shared return SOP policy CUSTOMER_B_PRIVATE_RETURN_RULE',
      tokenCount: 6,
      metadata: { fixture: 'customer-b-own-match' },
      embeddingRef: null,
      vectorId: null,
      enabled: true,
      createdAt: new Date(baseDate),
      updatedAt: new Date(baseDate)
    },
    {
      id: 'knowledge-chunk-customer-b-foreign-only-001',
      customerId: 'customer-b',
      documentId: 'knowledge-document-customer-b-foreign-only-001',
      chunkIndex: 0,
      heading: 'Foreign-only Return SOP',
      content: 'foreign-only-return-sop CUSTOMER_B_FOREIGN_ONLY_RETURN_RULE',
      tokenCount: 4,
      metadata: { fixture: 'customer-b-foreign-only' },
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
    customerId: 'customer-a',
    requestId: 'req-us3-action-draft-fixture',
    sessionId: 'session-owned-001',
    messageId: 'message-owned-assistant-001',
    actorId: 'actor-shared',
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
    },
    {
      ...common,
      id: 'action-draft-customer-b-waiting-001',
      customerId: 'customer-b',
      sessionId: 'session-hidden-001',
      messageId: 'message-hidden-assistant-001',
      idempotencyKey: 'workflow-shared-idempotency-key',
      status: ActionDraftStatus.waiting_confirmation,
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
    customerId: 'customer-a',
    requestId: 'req-us3-approval-fixture',
    sessionId: 'session-owned-001',
    messageId: 'message-owned-assistant-001',
    requesterActorId: 'actor-shared',
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
    },
    {
      ...common,
      id: 'approval-request-customer-b-pending-001',
      customerId: 'customer-b',
      sessionId: 'session-hidden-001',
      messageId: 'message-hidden-assistant-001',
      idempotencyKey: 'workflow-shared-idempotency-key'
    }
  ];
}

function createEscalationRequests(baseDate: Date): EscalationRequestRecord[] {
  const common = {
    customerId: 'customer-a',
    requestId: 'req-us3-escalation-fixture',
    sessionId: 'session-owned-001',
    messageId: 'message-owned-assistant-001',
    reason: EscalationReason.policy_required,
    ownerType: EscalationOwnerType.approver,
    summary: {
      riskLevel: RiskLevel.critical,
      reasonCode: EscalationReason.policy_required,
      reasonSummary: 'Critical-risk action requires manual escalation before any system side effect.',
      requesterActorId: 'actor-shared',
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
    },
    {
      ...common,
      id: 'escalation-request-customer-b-open-001',
      customerId: 'customer-b',
      sessionId: 'session-hidden-001',
      messageId: 'message-hidden-assistant-001',
      status: EscalationStatus.open,
      summary: {
        ...common.summary,
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
