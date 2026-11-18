import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser = require('cookie-parser');
import helmet from 'helmet';
import { setupSwagger } from '../common/docs/swagger.setup';
import { GlobalExceptionFilter } from '../common/errors/global-exception.filter';
import { RequestIdInterceptor } from '../common/request-id/request-id.interceptor';
import { ResponseEnvelopeInterceptor } from '../common/response/response-envelope.interceptor';
import { ADMIN_CSRF_HEADER, ADMIN_SESSION_COOKIE, AdminSettings } from './config/admin-settings';

/**
 * Feature 014: HTTP setup of the admin API, shared by src/admin-main.ts and the tests so both run the
 * same stack: security headers (helmet), cookies, CORS limited to the admin website, Core's
 * validation, error format and response envelope, and — local development only — Swagger UI.
 */
export function configureAdminApp(app: INestApplication): void {
  const settings = app.get(AdminSettings);
  app.setGlobalPrefix('api/v1/admin');
  // Behind nginx the peer is the proxy; the client IP (rate limits, audit) comes from X-Forwarded-For.
  (app as NestExpressApplication).set('trust proxy', settings.trustedProxyHops);
  // The API returns JSON only; CSP matters for HTML, so it is relaxed only when Swagger UI is served.
  app.use(helmet(settings.swaggerDocs ? { contentSecurityPolicy: false } : {}));
  app.use(cookieParser());
  app.enableCors({ origin: settings.webOrigin, credentials: true });
  app.useGlobalPipes(new ValidationPipe({ forbidNonWhitelisted: true, transform: true, whitelist: true }));
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(new RequestIdInterceptor(), new ResponseEnvelopeInterceptor());
  if (settings.swaggerDocs) setupAdminSwagger(app);
}

/**
 * Swagger UI at /api/v1/admin/docs. Sign in with `auth/login` (the browser keeps the session cookie),
 * then paste the `admin_csrf` cookie value under "Authorize" → csrf so state changes send X-CSRF-Token.
 * ADMIN_WEB_ORIGIN must be the Swagger page origin (e.g. http://localhost:3200) for the Origin check.
 */
function setupAdminSwagger(app: INestApplication): void {
  setupSwagger(app, {
    path: 'docs',
    title: 'Internal AI Assistant — Admin API',
    description: 'Back-office API (Feature 014). Local development only.',
    configure: (builder) => builder
      .addCookieAuth(ADMIN_SESSION_COOKIE, { type: 'apiKey', in: 'cookie', name: ADMIN_SESSION_COOKIE }, 'session')
      .addApiKey({ type: 'apiKey', in: 'header', name: ADMIN_CSRF_HEADER }, 'csrf')
      .addSecurityRequirements('session')
      .addSecurityRequirements('csrf')
  });
}
