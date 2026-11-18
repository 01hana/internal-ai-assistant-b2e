import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AdminSettings } from './admin-settings';
import { validateAdminEnvironment } from './admin-env.validation';

@Module({
  imports: [ConfigModule.forRoot({ cache: true, isGlobal: true, validate: validateAdminEnvironment })],
  providers: [AdminSettings],
  exports: [AdminSettings]
})
export class AdminConfigModule {}
