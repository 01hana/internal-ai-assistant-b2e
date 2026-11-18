import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { AdminModule } from './admin/admin.module';
import { AdminSettings } from './admin/config/admin-settings';
import { GlobalExceptionFilter } from './common/errors/global-exception.filter';
import { RequestIdInterceptor } from './common/request-id/request-id.interceptor';
import { ResponseEnvelopeInterceptor } from './common/response/response-envelope.interceptor';

/**
 * Feature 014: entry point of the admin back-office API. Same build and image as Core, started as a
 * separate process (`node dist/src/admin-main.js`) on its own port. Not reachable through the Gateway.
 */
async function bootstrap() {
  const app = await NestFactory.create(AdminModule, { bufferLogs: true });
  const settings = app.get(AdminSettings);

  app.setGlobalPrefix('api/v1/admin');
  app.use(cookieParser());
  app.enableCors({ origin: settings.webOrigin, credentials: true });
  app.useGlobalPipes(new ValidationPipe({ forbidNonWhitelisted: true, transform: true, whitelist: true }));
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(new RequestIdInterceptor(), new ResponseEnvelopeInterceptor());

  await app.listen(settings.port);
}

void bootstrap();
