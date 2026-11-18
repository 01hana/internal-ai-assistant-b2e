import { NestFactory } from '@nestjs/core';
import { configureAdminApp } from './admin/admin-app.setup';
import { AdminModule } from './admin/admin.module';
import { AdminSettings } from './admin/config/admin-settings';

/**
 * Feature 014: entry point of the admin back-office API. Same build and image as Core, started as a
 * separate process (`node dist/src/admin-main.js`) on its own port. Not reachable through the Gateway.
 */
async function bootstrap() {
  const app = await NestFactory.create(AdminModule, { bufferLogs: true });
  configureAdminApp(app);
  await app.listen(app.get(AdminSettings).port);
}

void bootstrap();
