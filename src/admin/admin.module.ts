import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { RequestIdMiddleware } from '../common/request-id/request-id.middleware';
import { PrismaModule } from '../prisma/prisma.module';
import { UserAuditService } from './audit/user-audit.service';
import { UserSessionService } from './auth/user-session.service';
import { UserTokenService } from './auth/user-token.service';
import { ADMIN_CLOCK, systemClock } from './common/clock';
import { AdminConfigModule } from './config/admin-config.module';
import { AdminCustomerCheck } from './config/admin-customer.check';
import { AdminSettings } from './config/admin-settings';
import { AdminMailService } from './mail/admin-mail.service';
import { ADMIN_MAIL_TRANSPORT, LogMailTransport, SmtpMailTransport } from './mail/admin-mail.transport';

/**
 * Feature 014: the admin back-office API, started only from src/admin-main.ts. It must not import the
 * Assistant, LLM or query modules, and Core's AppModule must not import it (architecture tests).
 */
@Module({
  imports: [AdminConfigModule, PrismaModule],
  providers: [
    { provide: ADMIN_CLOCK, useValue: systemClock },
    {
      provide: ADMIN_MAIL_TRANSPORT,
      inject: [AdminSettings],
      useFactory: (settings: AdminSettings) =>
        settings.mailTransport === 'log' ? new LogMailTransport() : new SmtpMailTransport(settings.mailFrom, settings.smtp)
    },
    AdminCustomerCheck,
    AdminMailService,
    UserAuditService,
    UserSessionService,
    UserTokenService
  ],
  exports: [ADMIN_CLOCK, AdminMailService, UserAuditService, UserSessionService, UserTokenService]
})
export class AdminModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware).forRoutes({ path: '*path', method: RequestMethod.ALL });
  }
}
