import { NestFactory } from '@nestjs/core';
import { GatewayConfigService } from './config/gateway-config.service';
import { GatewayModule } from './gateway.module';

export async function bootstrap() {
  const app = await NestFactory.create(GatewayModule, { bufferLogs: true });
  app.enableShutdownHooks();

  const config = app.get(GatewayConfigService).config;
  await app.listen(config.port);
  return app;
}

void bootstrap();
