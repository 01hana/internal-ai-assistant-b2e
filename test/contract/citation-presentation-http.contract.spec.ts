import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { LlmExecutionService } from '../../src/llm/llm-execution.service';
import type { GenerateAnswerInput } from '../../src/llm/llm-provider.interface';
import { GroundedAnswerFinalizerService } from '../../src/assistant/generation/grounded-answer-finalizer.service';
import { createAuthorizedInternalIdentityHeaders, createUs1TestAppWithState, parseSseResponse, Us1TestState } from '../support/us1-test-app.helper';
import { DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE } from '../support/internal-identity-jwt.helper';

const metadata = { provider: 'openai', model: 'synthetic-test', fallbackUsed: false };
const orderPage = { module: 'orders', entityType: 'order', entityId: 'SO-10001', visibleColumns: ['status'] };
const inventoryPage = { module: 'inventory', entityType: 'item', entityId: 'SKU-DEMO-RED', visibleColumns: ['availableQuantity'] };

describe('Citation presentation over Assistant HTTP', () => {
  const previousToolSelection = process.env.ASSISTANT_LLM_TOOL_SELECTION_ENABLED;
  let app: INestApplication;
  let state: Us1TestState;
  let llm: LlmExecutionService;

  beforeEach(async () => {
    // Answer presentation is under test; the controlled synthetic Tool still runs through Runtime.
    process.env.ASSISTANT_LLM_TOOL_SELECTION_ENABLED = 'false';
    ({ app, state } = await createUs1TestAppWithState());
    llm = app.get(LlmExecutionService, { strict: false });
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await app.close();
    if (previousToolSelection === undefined) delete process.env.ASSISTANT_LLM_TOOL_SELECTION_ENABLED;
    else process.env.ASSISTANT_LLM_TOOL_SELECTION_ENABLED = previousToolSelection;
  });

  function send(requestId: string, message: string, pageContext: Record<string, unknown>,
    permissionScopes = DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE.canonicalClaims.customerA.permission_scopes) {
    return request(app.getHttpServer()).post('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(createAuthorizedInternalIdentityHeaders(DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE, {
        claims: { ...DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE.canonicalClaims.customerA, permission_scopes: permissionScopes }, requestId
      })).send({ message, pageContext });
  }

  function citations(input: GenerateAnswerInput): string[] {
    const ids = input.instructions?.split('allowedCitations=')[1]?.split(',').map((id) => id.trim()) ?? [];
    if (!ids[0]) throw new Error('TEST_CITATION_MISSING');
    return ids;
  }

  function answer(response: Awaited<ReturnType<typeof send>>) {
    const events = parseSseResponse(response.text);
    const deltas = events.filter((event) => event.event === 'answer_delta')
      .map((event) => event.data.data.delta as string).join('');
    const final = events.find((event) => event.event === 'final')?.data.data.answer as string | undefined;
    return { events, deltas, final };
  }

  it('shows the older fixture stops at model selection before Citation when the local flag leaks in', async () => {
    process.env.ASSISTANT_LLM_TOOL_SELECTION_ENABLED = 'true';
    jest.spyOn(llm, 'generateAnswer').mockResolvedValue({ content: '核准證據顯示訂單狀態。', finishReason: 'stop', metadata });
    const finalizer = jest.spyOn(app.get(GroundedAnswerFinalizerService, { strict: false }), 'createStream');
    const requestId = 'req-citation-old-fixture-mode';
    const response = await send(requestId, '查詢訂單目前狀態 訂單號 SO-10001', orderPage);
    const selection = state.auditEvents.find((event) => event.requestId === requestId &&
      event.eventType === 'llm_tool_selection_completed');
    const userId = state.messages.find((item) => item.requestId === requestId && item.role === 'user')?.id;
    const plan = state.executionPlans.find((item) => item.messageId === userId);
    expect(selection?.metadata).toEqual(expect.objectContaining({ modelCalled: true, offeredCount: 1,
      reason: 'INVALID_MODEL_OUTPUT' }));
    expect(plan?.candidateTools).toEqual([]);
    expect(state.toolCalls.filter((item) => item.requestId === requestId)).toHaveLength(0);
    expect(finalizer).not.toHaveBeenCalled();
    expect(answer(response).final).toBe('目前無法安全選擇查詢工具，因此不能回答這個問題。');
  });

  it('keeps one verified Tool source readable across HTTP SSE, persistence, and History', async () => {
    let prompt: GenerateAnswerInput | undefined;
    jest.spyOn(llm, 'streamAnswer').mockImplementation(async function* (input) {
      prompt = input;
      const citation = citations(input)[0];
      for (const text of ['目前是 *', '*80 件**。 [', citation.slice(0, 4), citation.slice(4), ']']) {
        yield { type: 'text_delta', text };
      }
      yield { type: 'completed', finishReason: 'stop', metadata };
    });
    const requestId = 'req-citation-http-single';
    const response = await send(requestId, '查詢訂單目前狀態 訂單號 SO-10001', orderPage);
    const result = answer(response);
    expect(response.status).toBe(200);
    expect(result.final).toBe('目前是 80 件。\n\n資料來源：內部資料查詢');
    expect(result.deltas).toBe(result.final);
    expect(response.text).not.toMatch(/\*\*|〔1〕|\[citation-/u);
    const toolCalls = state.toolCalls.filter((item) => item.requestId === requestId);
    const evidence = state.evidenceRefs.filter((item) => item.requestId === requestId);
    expect(toolCalls).toEqual([expect.objectContaining({ status: 'success', executionStatus: 'executed' })]);
    expect(evidence).toEqual([expect.objectContaining({ sourceType: 'structured_record', toolCallId: toolCalls[0].id })]);
    expect(JSON.stringify(prompt?.messages)).toContain(evidence[0].id);
    expect(prompt?.instructions).toContain('allowedCitations=');
    expect(state.answerDecisions.find((item) => item.requestId === requestId)?.metadata)
      .toEqual(expect.objectContaining({ evidenceIds: [evidence[0].id] }));
    const stored = state.messages.find((item) => item.requestId === requestId && item.role === 'assistant');
    expect(stored?.content).toBe(result.final);
    const history = await request(app.getHttpServer()).get('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(createAuthorizedInternalIdentityHeaders(DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE, {
        claims: DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE.canonicalClaims.customerA, requestId: 'req-citation-http-history'
      }));
    expect(history.status).toBe(200);
    expect(history.body.data.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ messageId: stored?.id, content: result.final, answerDecision: 'answered' })
    ]));
  });

  it('keeps two verified Tool and Document sources distinct', async () => {
    let prompt: GenerateAnswerInput | undefined;
    jest.spyOn(llm, 'streamAnswer').mockImplementation(async function* (input) {
      prompt = input;
      const [first, second] = citations(input);
      if (!second) throw new Error('TEST_SECOND_CITATION_MISSING');
      yield { type: 'text_delta', text: `數量 80 [${first}]` };
      yield { type: 'text_delta', text: `；流程見文件 [${second}]` };
      yield { type: 'completed', finishReason: 'stop', metadata };
    });
    const requestId = 'req-citation-http-multiple';
    const response = await send(requestId, '查詢庫存可用量 料號 SKU-DEMO-RED，並依退貨流程 SOP 說明處理方式',
      inventoryPage, ['orders:read', 'inventory:read']);
    const result = answer(response);
    expect(response.status).toBe(200);
    expect(result.deltas).toBe(result.final);
    expect(result.final).toContain('數量 80〔1〕；流程見文件〔2〕');
    expect(result.final).toContain('資料來源：〔1〕內部資料查詢；〔2〕文件');
    expect(state.evidenceRefs.filter((item) => item.requestId === requestId).map((item) => item.sourceType).sort())
      .toEqual(['document_chunk', 'structured_record']);
    for (const ref of state.evidenceRefs.filter((item) => item.requestId === requestId)) {
      expect(JSON.stringify(prompt?.messages)).toContain(ref.id);
    }
  });

  it('never turns an unknown citation into a trusted source', async () => {
    jest.spyOn(llm, 'streamAnswer').mockImplementation(async function* () {
      yield { type: 'text_delta', text: '結果 [invented-citation]' };
      yield { type: 'completed', finishReason: 'stop', metadata };
    });
    const requestId = 'req-citation-http-invalid';
    const response = await send(requestId, '查詢訂單目前狀態 訂單號 SO-10001', orderPage);
    const events = parseSseResponse(response.text);
    expect(response.status).toBe(200);
    expect(events.map((event) => event.event)).not.toContain('final');
    expect(events.at(-1)?.event).toBe('error');
    expect(state.answerDecisions.filter((item) => item.requestId === requestId)).toHaveLength(0);
    expect(state.messages.find((item) => item.requestId === requestId && item.role === 'assistant')?.content).toBe('Pending answer.');
    expect(response.text).not.toContain('資料來源：');
  });
});
