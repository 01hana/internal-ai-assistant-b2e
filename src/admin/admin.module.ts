import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { RequestIdMiddleware } from '../common/request-id/request-id.middleware';
import { PrismaModule } from '../prisma/prisma.module';
import { UserAuditService } from './audit/user-audit.service';
import { AdminAuthController } from './auth/admin-auth.controller';
import { AdminAuthService } from './auth/admin-auth.service';
import { AdminSessionGuard } from './auth/admin-session.guard';
import { CsrfGuard } from './auth/csrf.guard';
import { ADMIN_THROTTLERS, AdminThrottlerGuard } from './auth/admin-throttler.guard';
import { AdminPermissionGuard } from './authorization/admin-permission.guard';
import { UserSessionService } from './auth/user-session.service';
import { UserTokenService } from './auth/user-token.service';
import { ADMIN_CLOCK, systemClock } from './common/clock';
import { AdminConfigModule } from './config/admin-config.module';
import { AdminCustomerCheck } from './config/admin-customer.check';
import { AdminSettings } from './config/admin-settings';
import { ConversationContentService } from './conversations/conversation-content';
import { ConversationsController } from './conversations/conversations.controller';
import { ConversationsService } from './conversations/conversations.service';
import { GroupsController } from './groups/groups.controller';
import { AdminHealthController } from './health/admin-health.controller';
import { GroupsService } from './groups/groups.service';
import { AdminMailService } from './mail/admin-mail.service';
import { ADMIN_MAIL_TRANSPORT, LogMailTransport, SmtpMailTransport } from './mail/admin-mail.transport';
import { StatsController } from './stats/stats.controller';
import { StatsService } from './stats/stats.service';
import { UsersController } from './users/users.controller';
import { UsersService } from './users/users.service';

/**
 * Feature 014: the admin back-office API, started only from src/admin-main.ts. It must not import the
 * Assistant, LLM or query modules, and Core's AppModule must not import it (architecture tests).
 */
@Module({
  imports: [AdminConfigModule, PrismaModule, ThrottlerModule.forRoot(ADMIN_THROTTLERS)],
  controllers: [AdminAuthController, AdminHealthController, ConversationsController, GroupsController, StatsController, UsersController],
  providers: [
    // Order matters: session → CSRF → permission.
    { provide: APP_GUARD, useClass: AdminSessionGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: AdminPermissionGuard },
    { provide: ADMIN_CLOCK, useValue: systemClock },
    {
      provide: ADMIN_MAIL_TRANSPORT,
      inject: [AdminSettings],
      useFactory: (settings: AdminSettings) =>
        settings.mailTransport === 'log' ? new LogMailTransport() : new SmtpMailTransport(settings.mailFrom, settings.smtp)
    },
    AdminAuthService,
    AdminCustomerCheck,
    AdminThrottlerGuard,
    AdminMailService,
    ConversationContentService,
    ConversationsService,
    GroupsService,
    StatsService,
    UserAuditService,
    UserSessionService,
    UserTokenService,
    UsersService
  ],
  exports: [ADMIN_CLOCK, AdminMailService, UserAuditService, UserSessionService, UserTokenService]
})
export class AdminModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware).forRoutes({ path: '*path', method: RequestMethod.ALL });
  }
}
