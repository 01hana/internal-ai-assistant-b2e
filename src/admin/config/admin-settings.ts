import { Inject, Injectable } from '@nestjs/common';
import type { AdminEnvironmentVariables } from './admin-env.validation';

/** The validated admin environment (see AdminConfigModule). */
export const ADMIN_ENVIRONMENT = Symbol('ADMIN_ENVIRONMENT');

/** Feature 014 timings (spec FR-003, FR-012, US2). */
export const ADMIN_SESSION_IDLE_MS = 30 * 60 * 1000;
export const ADMIN_SESSION_ABSOLUTE_MS = 12 * 60 * 60 * 1000;
export const ADMIN_SESSION_TOUCH_INTERVAL_MS = 60 * 1000;
export const FIRST_LOGIN_LINK_MS = 72 * 60 * 60 * 1000;
export const RESET_PASSWORD_LINK_MS = 60 * 60 * 1000;
export const RESET_PASSWORD_THROTTLE_MS = 15 * 60 * 1000;
export const LOGIN_LOCK_THRESHOLD = 5;
export const LOGIN_LOCK_MS = 15 * 60 * 1000;

export const ADMIN_SESSION_COOKIE = 'admin_session';
export const ADMIN_CSRF_COOKIE = 'admin_csrf';
export const ADMIN_CSRF_HEADER = 'x-csrf-token';

export type SmtpSettings = { host: string; port: number; secure: boolean; user?: string; password?: string };

/** Typed view of the admin environment. */
@Injectable()
export class AdminSettings {
  constructor(@Inject(ADMIN_ENVIRONMENT) private readonly env: AdminEnvironmentVariables) {}

  get port(): number {
    return this.env.ADMIN_PORT;
  }

  /** Origins allowed by CORS and the Origin check. */
  get webOrigins(): string[] {
    return this.env.ADMIN_WEB_ORIGIN.map((origin) => new URL(origin).origin);
  }

  /** The admin website mail links point to: the first configured origin. */
  get webOrigin(): string {
    return this.webOrigins[0];
  }

  get customerId(): string {
    return this.env.ADMIN_CUSTOMER_ID;
  }

  get timeZone(): string {
    return this.env.ADMIN_TIME_ZONE;
  }

  /** Feature 016: Capability Pack files (JSON array), loaded at startup like Core. */
  get capabilityPackPathsJson(): string {
    return this.env.ASSISTANT_CAPABILITY_PACK_PATHS_JSON;
  }

  get trustedProxyHops(): number {
    return this.env.ADMIN_TRUSTED_PROXY_HOPS;
  }

  get cookieSecure(): boolean {
    return this.env.ADMIN_COOKIE_SECURE === 'true';
  }

  get swaggerDocs(): boolean {
    return this.env.ADMIN_ENABLE_SWAGGER_DOCS === 'true';
  }

  get mailTransport(): 'smtp' | 'log' {
    return this.env.ADMIN_MAIL_TRANSPORT;
  }

  get mailFrom(): string {
    return this.env.ADMIN_MAIL_FROM ?? '';
  }

  get smtp(): SmtpSettings {
    return {
      host: this.env.ADMIN_SMTP_HOST ?? '',
      port: this.env.ADMIN_SMTP_PORT ?? 0,
      secure: this.env.ADMIN_SMTP_SECURE === 'true',
      user: this.env.ADMIN_SMTP_USER || undefined,
      password: this.env.ADMIN_SMTP_PASSWORD || undefined
    };
  }

  /** Front-end page a mail link opens; the token is read and removed from the URL by the page. */
  linkUrl(path: '/auth/firstLogin' | '/auth/reset', token: string): string {
    const url = new URL(path, this.webOrigin);
    url.searchParams.set('token', token);
    return url.toString();
  }
}
