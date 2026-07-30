import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { GatewayConfigService } from './gateway-config.service';
import { GatewayModule } from './gateway.module';

async function bootstrap() {
  const app = await NestFactory.create(GatewayModule, { bufferLogs: true });
  const config = app.get(GatewayConfigService);
  await app.listen(config.port);
}

void bootstrap();
