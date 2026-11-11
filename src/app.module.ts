import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { AssistantModule } from './assistant/assistant.module';
import { CapabilitiesModule } from './capabilities/capabilities.module';
import { AppConfigModule } from './common/config/app-config.module';
import { RequestIdMiddleware } from './common/request-id/request-id.middleware';
import { ObservabilityModule } from './observability/observability.module';
import { PrismaModule } from './prisma/prisma.module';
import { loadQueryScopeRegistrationsFromEnv, QUERY_SCOPE_POLICY_PATHS_ENV } from './query-scope/query-scope-config';
import type { QueryScopeRegistration } from './query-scope/query-scope.types';

// Customer Query Scope policies come only from configured files (ASSISTANT_QUERY_SCOPE_POLICY_PATHS_JSON).
// Activations and registrations of one composition must be the same exact objects, so the
// result is reused while the configured value is unchanged and reloaded when it changes.
let cachedQueryScope: Readonly<{ key: string | undefined; registrations: readonly QueryScopeRegistration[] }> | undefined;
function configuredQueryScopeRegistrations(): readonly QueryScopeRegistration[] {
  const key = process.env[QUERY_SCOPE_POLICY_PATHS_ENV];
  if (!cachedQueryScope || cachedQueryScope.key !== key) {
    cachedQueryScope = Object.freeze({ key, registrations: loadQueryScopeRegistrationsFromEnv(process.env) });
  }
  return cachedQueryScope.registrations;
}

@Module({
  imports: [AppConfigModule, PrismaModule, CapabilitiesModule, AssistantModule.register({
    activations: configuredQueryScopeRegistrations,
    registrations: configuredQueryScopeRegistrations
  }), ObservabilityModule]
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware).forRoutes({ path: '*path', method: RequestMethod.ALL });
  }
}
