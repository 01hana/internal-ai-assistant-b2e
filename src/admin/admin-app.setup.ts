import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser = require('cookie-parser');
import helmet from 'helmet';
import { GlobalExceptionFilter } from '../common/errors/global-exception.filter';
import { RequestIdInterceptor } from '../common/request-id/request-id.interceptor';
import { ResponseEnvelopeInterceptor } from '../common/response/response-envelope.interceptor';
import { AdminSettings } from './config/admin-settings';

/**
 * Feature 014: HTTP setup of the admin API, shared by src/admin-main.ts and the tests so both run the
 * same stack: security headers (helmet), cookies, CORS limited to the admin website, Core's
 * validation, error format and response envelope.
 */
export function configureAdminApp(app: INestApplication): void {
  const settings = app.get(AdminSettings);
  app.setGlobalPrefix('api/v1/admin');
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({ origin: settings.webOrigin, credentials: true });
  app.useGlobalPipes(new ValidationPipe({ forbidNonWhitelisted: true, transform: true, whitelist: true }));
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(new RequestIdInterceptor(), new ResponseEnvelopeInterceptor());
}
