import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { AppConfigModule } from './common/config/app-config.module';
import { RequestIdMiddleware } from './common/request-id/request-id.middleware';

@Module({
  imports: [AppConfigModule]
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
