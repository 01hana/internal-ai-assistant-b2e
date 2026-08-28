import { NestFactory } from '@nestjs/core';
import { BridgeModule } from './bridge.module';

export async function bootstrap() {
  const app = await NestFactory.create(BridgeModule, { bufferLogs: true });
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3000);
  return app;
}

void bootstrap();
