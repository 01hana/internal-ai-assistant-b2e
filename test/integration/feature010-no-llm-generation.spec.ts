import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { LlmExecutionService } from '../../src/llm/llm-execution.service';
import { createAuthorizedInternalIdentityHeaders, createUs1TestAppWithState } from '../support/us1-test-app.helper';
import { DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE } from '../support/internal-identity-jwt.helper';

describe('Feature 010 does not generate with an LLM (T072)', () => {
  let app: INestApplication;
  beforeAll(async () => ({ app } = await createUs1TestAppWithState()));
  afterAll(async () => app.close());

  it('uses the existing deterministic AnswerDecision sink without invoking LlmExecutionService', async () => {
    const llm = app.get(LlmExecutionService, { strict: false });
    const generate = jest.spyOn(llm, 'generateAnswer');
    const classify = jest.spyOn(llm, 'classifyIntent');
    const summarize = jest.spyOn(llm, 'summarize');
    await request(app.getHttpServer()).post('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(createAuthorizedInternalIdentityHeaders(DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE, { requestId: 'req-f010-no-llm' }))
      .send({ message: '退貨流程 SOP 怎麼說？', pageContext: { module: 'orders', visibleColumns: [] } });
    expect(generate).not.toHaveBeenCalled();
    expect(classify).not.toHaveBeenCalled();
    expect(summarize).not.toHaveBeenCalled();
  });
});
