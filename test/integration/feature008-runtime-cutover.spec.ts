import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { DataAdapter, DataAdapterExecuteInput } from '../../src/connectors/data-adapter.interface';
import { DataAdapterRegistrations } from '../../src/connectors/data-adapter-registration';
import { DataAdapterRegistry } from '../../src/connectors/data-adapter-registry.service';
import { AdapterResultProjectorService } from '../../src/connectors/adapter-result-projector.service';
import { ToolCallService } from '../../src/assistant/runtime/tool-call.service';
import { ToolRegistryService } from '../../src/tools/tool-registry.service';
import * as groundedAnswer from '../../src/assistant/runtime/grounded-answer-input.types';
import {
  createAuthorizedInternalIdentityHeaders,
  createIdentityHeaders,
  createUs1TestAppWithState,
  parseSseResponse,
  Us1TestState
} from '../support/us1-test-app.helper';
import { DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE } from '../support/internal-identity-jwt.helper';

const CONNECTOR_CONTEXT_REF = 'ccr_phase5_selected_adapter_only';
let apps: INestApplication[] = [];

describe('Feature 008 registry runtime cutover', () => {
  afterEach(async () => {
    await Promise.all(apps.map((app) => app.close()));
    apps = [];
    jest.restoreAllMocks();
  });

  it('selects one exact registration and passes transient context only to that adapter', async () => {
    const adapter = createAdapter();
    const { app, state } = await createScenario(registrations(adapter));
    const project = jest.spyOn(app.get(AdapterResultProjectorService), 'project');

    const response = await sendOrderRequest(app, 'req-phase5-success');

    expect(response.status).toBe(200);
    expect(adapter.isCompatible).toHaveBeenCalledWith(expect.objectContaining({
      host: expect.objectContaining({ customerId: 'customer-a', integrationId: 'integration-erp', hostApp: 'erp' }),
      operation: expect.objectContaining({ canonicalToolKey: 'mock.orders.status.lookup' })
    }));
    expect(JSON.stringify(adapter.isCompatible.mock.calls)).not.toContain(CONNECTOR_CONTEXT_REF);
    expect(adapter.execute).toHaveBeenCalledWith(expect.objectContaining({
      host: expect.objectContaining({ customerId: 'customer-a', integrationId: 'integration-erp', hostApp: 'erp' }),
      operation: expect.objectContaining({ canonicalToolKey: 'mock.orders.status.lookup' }),
      transientConnectorContext: { connectorContextRef: CONNECTOR_CONTEXT_REF }
    }));
    expect(state.toolCalls.at(-1)).toEqual(expect.objectContaining({ status: 'success', executionStatus: 'executed' }));
    expect(project.mock.results.at(-1)?.value).toEqual(expect.objectContaining({
      projected: true,
      result: expect.objectContaining({ kind: 'safe_projected_adapter_result' })
    }));
    expect(state.evidenceRefs.at(-1)).toEqual(expect.objectContaining({ sourceId: 'SO-10001' }));
    expect(parseSseResponse(response.text).at(-1)?.data?.data).toEqual(expect.objectContaining({
      answerDecision: 'answered',
      answer: expect.stringContaining('picking')
    }));
    assertReferenceAbsentFromSinks(state, response);
  });

  it.each([
    ['missing', Object.freeze([]) as DataAdapterRegistrations],
    ['ambiguous', null]
  ])('fails closed for %s registrations without direct-mock fallback', async (_label, configured) => {
    const adapter = createAdapter();
    const scenarioRegistrations = configured ?? Object.freeze([
      exactRegistration(adapter),
      exactRegistration(createAdapter())
    ]);
    const { app, state } = await createScenario(scenarioRegistrations);
    const initialEvidenceCount = state.evidenceRefs.length;

    const response = await sendOrderRequest(app, `req-phase5-${_label}`);

    expect(response.status).toBe(200);
    expect(adapter.execute).not.toHaveBeenCalled();
    expect(state.toolCalls.at(-1)).toEqual(expect.objectContaining({
      status: 'failed',
      executionStatus: 'failed',
      errorCode: 'DATA_ADAPTER_UNAVAILABLE'
    }));
    expect(state.evidenceRefs).toHaveLength(initialEvidenceCount);
    expect(finalData(response)).toEqual(expect.objectContaining({
      answerDecision: 'no_answer',
      noAnswerReason: 'tool_failure',
      errorCode: 'DATA_ADAPTER_UNAVAILABLE'
    }));
  });

  it.each([
    ['incompatible', createAdapter({ compatible: false })],
    ['unhealthy', createAdapter({ health: 'unavailable' })]
  ])('fails closed when the exact adapter is %s', async (_label, adapter) => {
    const { app, state } = await createScenario(registrations(adapter));
    const initialEvidenceCount = state.evidenceRefs.length;

    const response = await sendOrderRequest(app, `req-phase5-${_label}`);

    expect(response.status).toBe(200);
    expect(adapter.execute).not.toHaveBeenCalled();
    expect(state.toolCalls.at(-1)).toEqual(expect.objectContaining({ errorCode: 'DATA_ADAPTER_UNAVAILABLE' }));
    expect(state.evidenceRefs).toHaveLength(initialEvidenceCount);
  });

  it('short-circuits permission denial before registry selection or adapter execution', async () => {
    const adapter = createAdapter();
    const { app, state } = await createScenario(registrations(adapter));
    const select = jest.spyOn(app.get(DataAdapterRegistry), 'select');

    const response = await sendOrderRequest(app, 'req-phase5-permission', {
      ...createAuthorizedInternalIdentityHeaders(DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE, {
        claims: { permission_scopes: [] },
        requestId: 'req-phase5-permission'
      })
    });

    expect(response.status).toBe(200);
    expect(select).not.toHaveBeenCalled();
    expect(adapter.execute).not.toHaveBeenCalled();
    expect(state.toolCalls.at(-1)).toEqual(expect.objectContaining({ status: 'blocked', executionStatus: 'not_started' }));
  });

  it('short-circuits invalid structured input before registry selection or adapter execution', async () => {
    const adapter = createAdapter();
    const { app, state } = await createScenario(registrations(adapter));
    const select = jest.spyOn(app.get(DataAdapterRegistry), 'select');
    const toolRegistry = app.get(ToolRegistryService);
    const validateNamedOperation = toolRegistry.validateNamedOperation.bind(toolRegistry);
    let validationCount = 0;
    jest.spyOn(toolRegistry, 'validateNamedOperation').mockImplementation((tool, candidate) => {
      validationCount += 1;
      return validationCount === 1
        ? validateNamedOperation(tool, candidate)
        : { valid: false, deniedReason: 'schema_invalid', schemaErrorReason: 'test_invalid_input' };
    });

    const response = await sendOrderRequest(app, 'req-phase5-invalid-input');

    expect(response.status).toBe(200);
    expect(select).not.toHaveBeenCalled();
    expect(adapter.execute).not.toHaveBeenCalled();
    expect(state.toolCalls.at(-1)).toEqual(expect.objectContaining({ status: 'blocked', executionStatus: 'not_started' }));
  });

  it.each([
    ['returned failure', createAdapter({ executeResult: { toolKey: 'mock.orders.status.lookup', status: 'failed', error: { code: 'NOT_FOUND', message: 'not found' } } }), 'NOT_FOUND'],
    ['thrown failure', createAdapter({ executeError: new Error('PRIVATE_CONNECTOR_DETAIL') }), 'TOOL_EXECUTION_FAILED'],
    ['malformed output', createAdapter({ data: { orderId: 'SO-10001', status: 'picking', rawSecret: 'PRIVATE_RAW_RESULT' } }), 'ADAPTER_RESULT_PROJECTION_FAILED']
  ])('fails the started ToolCall for %s and creates no evidence', async (_label, adapter, expectedCode) => {
    const { app, state } = await createScenario(registrations(adapter));
    const initialEvidenceCount = state.evidenceRefs.length;

    const response = await sendOrderRequest(app, `req-phase5-${_label.replace(/\s/g, '-')}`);

    expect(response.status).toBe(200);
    expect(state.toolCalls.at(-1)).toEqual(expect.objectContaining({
      status: 'failed',
      executionStatus: 'failed',
      errorCode: expectedCode
    }));
    expect(state.evidenceRefs).toHaveLength(initialEvidenceCount);
    expect(JSON.stringify({ state: state.toolCalls, response: response.text })).not.toContain('PRIVATE_CONNECTOR_DETAIL');
    expect(JSON.stringify({ state: state.toolCalls, response: response.text })).not.toContain('PRIVATE_RAW_RESULT');
  });

  it('fails atomically when projection rejects otherwise successful adapter output', async () => {
    const adapter = createAdapter();
    const { app, state } = await createScenario(registrations(adapter));
    const initialEvidenceCount = state.evidenceRefs.length;
    jest.spyOn(app.get(AdapterResultProjectorService), 'project').mockReturnValue({
      projected: false,
      errorCode: 'ADAPTER_RESULT_PROJECTION_FAILED'
    });
    const groundedInput = jest.spyOn(groundedAnswer, 'createGroundedAnswerInput');

    const response = await sendOrderRequest(app, 'req-phase5-projection-failure');

    expect(response.status).toBe(200);
    expect(state.toolCalls.at(-1)).toEqual(expect.objectContaining({
      status: 'failed',
      executionStatus: 'failed',
      errorCode: 'ADAPTER_RESULT_PROJECTION_FAILED'
    }));
    expect(state.evidenceRefs).toHaveLength(initialEvidenceCount);
    expect(groundedInput).not.toHaveBeenCalled();
  });

  it('fails atomically when the trusted ToolDefinition has no valid result policy', async () => {
    const adapter = createAdapter();
    const { app, state } = await createScenario(registrations(adapter));
    const initialEvidenceCount = state.evidenceRefs.length;
    const orderTool = state.toolDefinitions.find((tool) => tool.name === 'mock.orders.status.lookup');
    expect(orderTool).toBeDefined();
    orderTool!.outputSchema = {
      type: 'object',
      additionalProperties: false,
      required: ['orderId', 'status'],
      properties: { orderId: { type: 'string' }, status: { type: 'string' } }
    };

    const response = await sendOrderRequest(app, 'req-phase5-missing-result-policy');

    expect(response.status).toBe(200);
    expect(state.toolCalls.at(-1)).toEqual(expect.objectContaining({ errorCode: 'ADAPTER_RESULT_PROJECTION_FAILED' }));
    expect(state.evidenceRefs).toHaveLength(initialEvidenceCount);
  });

  it('fails the started ToolCall when safe completion throws', async () => {
    const adapter = createAdapter();
    const { app, state } = await createScenario(registrations(adapter));
    const initialEvidenceCount = state.evidenceRefs.length;
    jest.spyOn(app.get(ToolCallService), 'completeToolCall').mockRejectedValue(new Error('PRIVATE_COMPLETION_DETAIL'));

    const response = await sendOrderRequest(app, 'req-phase5-completion-failure');

    expect(response.status).toBe(200);
    expect(state.toolCalls.at(-1)).toEqual(expect.objectContaining({
      status: 'failed',
      executionStatus: 'failed',
      errorCode: 'ADAPTER_RESULT_PROJECTION_FAILED'
    }));
    expect(state.evidenceRefs).toHaveLength(initialEvidenceCount);
    expect(response.text).not.toContain('PRIVATE_COMPLETION_DETAIL');
  });

  it('enforces the trusted ToolDefinition timeout after ToolCall start and ignores late adapter completion', async () => {
    const lateSuccessSentinel = 'PRIVATE_LATE_ADAPTER_SUCCESS_008';
    let adapterResolved = false;
    const adapter = createAdapter({
      executeImplementation: async (input) => {
        await delay(50);
        adapterResolved = true;
        return {
          toolKey: input.operation.canonicalToolKey,
          status: 'succeeded',
          data: { orderId: 'SO-10001', status: lateSuccessSentinel }
        };
      }
    });
    const scenario = await createScenario(registrations(adapter));
    const state = scenario.state;
    const startToolCall = jest.spyOn(scenario.app.get(ToolCallService), 'startToolCall');
    const orderTool = state.toolDefinitions.find((tool) => tool.name === 'mock.orders.status.lookup');
    expect(orderTool).toBeDefined();
    orderTool!.timeoutMs = 5;
    const groundedInput = jest.spyOn(groundedAnswer, 'createGroundedAnswerInput');
    const initialEvidenceCount = state.evidenceRefs.length;

    const response = await sendOrderRequest(scenario.app, 'req-phase5-trusted-timeout');

    expect(response.status).toBe(200);
    expect(startToolCall).toHaveBeenCalledTimes(1);
    expect(adapter.execute).toHaveBeenCalledTimes(1);
    expect(startToolCall.mock.invocationCallOrder[0]).toBeLessThan(adapter.execute.mock.invocationCallOrder[0]);
    expect(state.toolCalls.at(-1)).toEqual(expect.objectContaining({
      status: 'failed',
      executionStatus: 'failed',
      errorCode: 'TOOL_EXECUTION_FAILED'
    }));
    expect(state.evidenceRefs).toHaveLength(initialEvidenceCount);
    expect(groundedInput).not.toHaveBeenCalled();
    expect(finalData(response)).toEqual(expect.objectContaining({
      answerDecision: 'no_answer',
      noAnswerReason: 'tool_failure',
      errorCode: 'TOOL_EXECUTION_FAILED'
    }));
    expect(parseSseResponse(response.text).map((event) => event.event)).toEqual([
      'tool_call_started',
      'tool_call_failed',
      'answer_delta',
      'final'
    ]);
    expect(JSON.stringify({
      toolCalls: state.toolCalls,
      evidenceRefs: state.evidenceRefs,
      auditEvents: state.auditEvents,
      response: response.text
    })).not.toContain(lateSuccessSentinel);

    const failedToolCallSnapshot = structuredClone(state.toolCalls.at(-1));
    const evidenceCountAfterResponse = state.evidenceRefs.length;
    await delay(60);

    expect(adapterResolved).toBe(true);
    expect(state.toolCalls.at(-1)).toEqual(failedToolCallSnapshot);
    expect(state.evidenceRefs).toHaveLength(evidenceCountAfterResponse);
    expect(groundedInput).not.toHaveBeenCalled();
    expect(response.text).not.toContain(lateSuccessSentinel);
  });
});

async function createScenario(dataAdapterRegistrations: DataAdapterRegistrations) {
  const scenario = await createUs1TestAppWithState({ dataAdapterRegistrations });
  apps.push(scenario.app);
  return scenario;
}

async function sendOrderRequest(
  app: INestApplication,
  requestId: string,
  headers: Record<string, string> = createIdentityHeaders({ 'x-request-id': requestId })
) {
  return request(app.getHttpServer())
    .post('/api/v1/assistant/sessions/session-owned-001/messages')
    .set(headers)
    .send({
      message: '請查 SO-10001 訂單狀態',
      pageContext: {
        connectorContextRef: CONNECTOR_CONTEXT_REF,
        module: 'orders',
        entityType: 'order',
        entityId: 'SO-10001',
        visibleColumns: ['orderId', 'status']
      }
    });
}

function registrations(adapter: ReturnType<typeof createAdapter>): DataAdapterRegistrations {
  return Object.freeze([exactRegistration(adapter)]);
}

function exactRegistration(adapter: DataAdapter) {
  return Object.freeze({
    adapter,
    connectorKey: 'mock',
    customerId: 'customer-a',
    integrationId: 'integration-erp',
    hostApp: 'erp',
    active: true
  });
}

function createAdapter(options: {
  compatible?: boolean;
  health?: 'healthy' | 'degraded' | 'unavailable';
  data?: Record<string, unknown>;
  executeResult?: Awaited<ReturnType<DataAdapter['execute']>>;
  executeError?: Error;
  executeImplementation?: (input: DataAdapterExecuteInput) => ReturnType<DataAdapter['execute']>;
} = {}) {
  const execute = jest.fn(async (input: DataAdapterExecuteInput) => {
    if (options.executeImplementation) return options.executeImplementation(input);
    if (options.executeError) throw options.executeError;
    return options.executeResult ?? {
      toolKey: input.operation.canonicalToolKey,
      status: 'succeeded' as const,
      data: options.data ?? { orderId: 'SO-10001', status: 'picking' }
    };
  });

  return {
    key: 'phase5-fixture',
    metadata: Object.freeze({
      adapterKey: 'phase5-fixture',
      sourceSystem: 'phase5-fixture',
      supportedHostApps: Object.freeze(['erp']),
      supportedCapabilities: Object.freeze(['mock.orders.status.lookup'])
    }),
    listTools: jest.fn(() => []),
    isCompatible: jest.fn(() => ({ compatible: options.compatible ?? true })),
    healthCheck: jest.fn(async () => ({
      dependency: 'phase5-fixture',
      status: options.health ?? 'healthy',
      checkedAt: '2026-09-08T00:00:00.000Z'
    })),
    execute
  } satisfies DataAdapter;
}

function finalData(response: request.Response) {
  return parseSseResponse(response.text).find((event) => event.event === 'final')?.data?.data;
}

function assertReferenceAbsentFromSinks(state: Us1TestState, response: request.Response): void {
  expect(JSON.stringify({
    sessions: state.sessions,
    messages: state.messages,
    contextStates: state.contextStates,
    executionPlans: state.executionPlans,
    toolCalls: state.toolCalls,
    evidenceRefs: state.evidenceRefs,
    auditEvents: state.auditEvents,
    sseBuilderInputs: state.orchestration.sseEventBuilds.mock.calls,
    serializedSse: response.text,
    publicResponse: response.body
  })).not.toContain(CONNECTOR_CONTEXT_REF);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
