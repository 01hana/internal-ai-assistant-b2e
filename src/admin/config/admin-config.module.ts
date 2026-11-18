import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ADMIN_ENVIRONMENT, AdminSettings } from './admin-settings';
import { validateAdminEnvironment } from './admin-env.validation';

/**
 * Loads `.env` (without validating at import time) and validates the admin variables when the
 * application is created. Validating inside `ConfigModule.forRoot` would run as soon as this file is
 * imported, before a caller (a test, the bootstrap CLI) has set its environment.
 */
@Module({
  imports: [ConfigModule.forRoot({ cache: true, isGlobal: true })],
  providers: [{ provide: ADMIN_ENVIRONMENT, useFactory: () => validateAdminEnvironment(process.env) }, AdminSettings],
  exports: [AdminSettings]
})
export class AdminConfigModule {}
