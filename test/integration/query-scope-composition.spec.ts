import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Test } from '@nestjs/testing';
import { AssistantModule } from '../../src/assistant/assistant.module';
import { AssistantMessageService } from '../../src/assistant/message/assistant-message.service';
import { AssistantReadonlyRuntimeService } from '../../src/assistant/runtime/assistant-readonly-runtime.service';
import { AppConfigModule } from '../../src/common/config/app-config.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { QueryScopeValidationService } from '../../src/query-scope/query-scope-validation.service';
import {
  QUERY_SCOPE_ACTIVATIONS,
  QUERY_SCOPE_REGISTRATIONS,
  QueryScopeActivation,
  QueryScopeRegistration
} from '../../src/query-scope/query-scope.types';
import { createUs1TestAppWithState } from '../support/us1-test-app.helper';
import { SYNTHETIC_QUERY_SCOPE_POLICY_PATH } from '../support/query-scope.fixture';

describe('Query Scope application composition', () => {
  const originalPolicyPaths = process.env.ASSISTANT_QUERY_SCOPE_POLICY_PATHS_JSON;

  afterEach(() => {
    if (originalPolicyPaths === undefined) delete process.env.ASSISTANT_QUERY_SCOPE_POLICY_PATHS_JSON;
    else process.env.ASSISTANT_QUERY_SCOPE_POLICY_PATHS_JSON = originalPolicyPaths;
  });

  it('compiles and initializes the generic AssistantModule without a Customer composition', async () => {
    const original = Object.fromEntries([
      'DATABASE_URL', 'POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DB', 'LLM_MODEL', 'OPENAI_API_KEY',
      'INTERNAL_IDENTITY_JWT_ISSUER', 'INTERNAL_IDENTITY_JWT_AUDIENCE', 'INTERNAL_IDENTITY_JWKS_URI',
      'ASSISTANT_CAPABILITY_PACK_PATHS_JSON'
    ].map((key) => [key, process.env[key]]));
    Object.assign(process.env, {
      DATABASE_URL: 'postgresql://assistant:test@localhost:5432/assistant_test',
      POSTGRES_USER: 'assistant', POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'assistant_test',
      LLM_MODEL: 'test-model', OPENAI_API_KEY: 'placeholder-openai-api-key',
      INTERNAL_IDENTITY_JWT_ISSUER: 'https://gateway.test.internal',
      INTERNAL_IDENTITY_JWT_AUDIENCE: 'internal-assistant-core-test',
      INTERNAL_IDENTITY_JWKS_URI: 'https://gateway.test.internal/.well-known/jwks.json',
      ASSISTANT_CAPABILITY_PACK_PATHS_JSON: '[]'
    });
    delete process.env.ASSISTANT_QUERY_SCOPE_POLICY_PATHS_JSON;
    try {
      const moduleRef = await Test.createTestingModule({ imports: [AppConfigModule, AssistantModule.register()] })
        .overrideProvider(PrismaService)
        .useValue({ onModuleInit: jest.fn(), onModuleDestroy: jest.fn(), db: {} })
        .compile();
      const app = moduleRef.createNestApplication();
      try {
        await app.init();
        expect(app.get<readonly QueryScopeActivation[]>(QUERY_SCOPE_ACTIVATIONS)).toEqual([]);
        expect(app.get<readonly QueryScopeRegistration[]>(QUERY_SCOPE_REGISTRATIONS)).toEqual([]);
        expect(app.get(QueryScopeValidationService)).toBeInstanceOf(QueryScopeValidationService);
      } finally {
        await app.close();
      }
    } finally {
      for (const [key, value] of Object.entries(original)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it('initializes the core with no Customer policy and resolves the same validator at both security gates', async () => {
    delete process.env.ASSISTANT_QUERY_SCOPE_POLICY_PATHS_JSON;
    const { app } = await createUs1TestAppWithState({ capabilityPackPaths: [] });
    try {
      expect(app.get<readonly QueryScopeActivation[]>(QUERY_SCOPE_ACTIVATIONS)).toEqual([]);
      expect(app.get<readonly QueryScopeRegistration[]>(QUERY_SCOPE_REGISTRATIONS)).toEqual([]);
      const validator = app.get(QueryScopeValidationService);
      expect((app.get(AssistantMessageService) as unknown as { queryScopeValidation: unknown }).queryScopeValidation).toBe(validator);
      expect((app.get(AssistantReadonlyRuntimeService) as unknown as { queryScopeValidation: unknown }).queryScopeValidation).toBe(validator);
    } finally {
      await app.close();
    }
  });

  it('installs only the exact registrations from configured policy files in the AssistantModule DI scope', async () => {
    process.env.ASSISTANT_QUERY_SCOPE_POLICY_PATHS_JSON = JSON.stringify([SYNTHETIC_QUERY_SCOPE_POLICY_PATH]);
    const { app } = await createUs1TestAppWithState({ capabilityPackPaths: [] });
    try {
      const registrations = app.get<readonly QueryScopeRegistration[]>(QUERY_SCOPE_REGISTRATIONS);
      const activations = app.get<readonly QueryScopeActivation[]>(QUERY_SCOPE_ACTIVATIONS);
      expect(registrations).toHaveLength(3);
      expect(activations).toEqual(registrations);
      expect(registrations.map(({ customerId, integrationId, hostApp, toolKey }) => ({ customerId, integrationId, hostApp, toolKey })))
        .toEqual(['today', 'weekly', 'monthly'].map((period) => ({
          customerId: 'customer-a',
          integrationId: 'integration-erp',
          hostApp: 'erp',
          toolKey: `work-orders.${period}-new-count`
        })));
      expect(registrations.every((registration) => typeof registration.policy?.evaluate === 'function')).toBe(true);
    } finally {
      await app.close();
    }
  });

  it('keeps the generic AssistantModule free of Customer registration imports', () => {
    const source = readFileSync(resolve('src/assistant/assistant.module.ts'), 'utf8');
    expect(source).not.toMatch(/customer-query-scope|shinmone/i);
  });

  it('keeps Core Query Scope composition free of Customer vocabulary and Customer imports', () => {
    for (const file of ['src/app.module.ts', 'src/query-scope/company-scope.policy.ts', 'src/query-scope/query-scope-config.ts']) {
      const source = readFileSync(resolve(file), 'utf8');
      expect({ file, match: source.match(/customer-query-scope|customers\/|shinmone|公司|工單|廠商/i)?.[0] })
        .toEqual({ file, match: undefined });
    }
  });
});
