import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { AssistantModule } from './assistant/assistant.module';
import { AppConfigModule } from './common/config/app-config.module';
import { RequestIdMiddleware } from './common/request-id/request-id.middleware';
import { ObservabilityModule } from './observability/observability.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [AppConfigModule, PrismaModule, AssistantModule, ObservabilityModule]
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware).forRoutes({ path: '*path', method: RequestMethod.ALL });
  }
}
