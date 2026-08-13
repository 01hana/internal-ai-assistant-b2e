import { NestFactory } from '@nestjs/core';
import { GatewayConfigService } from './config/gateway-config.service';
import { gatewayCorsOptions } from './config/gateway-cors.config';
import { GatewayModule } from './gateway.module';

export async function bootstrap() {
  const app = await NestFactory.create(GatewayModule, { bufferLogs: true });
  app.enableShutdownHooks();

  const config = app.get(GatewayConfigService).config;
  app.enableCors(gatewayCorsOptions(config.allowedOrigins));
  await app.listen(config.port);
  return app;
}

void bootstrap();
