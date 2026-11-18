import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AdminEnvironmentVariables } from './admin-env.validation';

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
  constructor(private readonly config: ConfigService<AdminEnvironmentVariables, true>) {}

  get port(): number {
    return this.config.get('ADMIN_PORT', { infer: true });
  }

  get webOrigin(): string {
    return new URL(this.config.get('ADMIN_WEB_ORIGIN', { infer: true })).origin;
  }

  get customerId(): string {
    return this.config.get('ADMIN_CUSTOMER_ID', { infer: true });
  }

  get cookieSecure(): boolean {
    return this.config.get('ADMIN_COOKIE_SECURE', { infer: true }) === 'true';
  }

  get mailTransport(): 'smtp' | 'log' {
    return this.config.get('ADMIN_MAIL_TRANSPORT', { infer: true });
  }

  get mailFrom(): string {
    return this.config.get('ADMIN_MAIL_FROM', { infer: true }) ?? '';
  }

  get smtp(): SmtpSettings {
    return {
      host: this.config.get('ADMIN_SMTP_HOST', { infer: true }) ?? '',
      port: this.config.get('ADMIN_SMTP_PORT', { infer: true }) ?? 0,
      secure: this.config.get('ADMIN_SMTP_SECURE', { infer: true }) === 'true',
      user: this.config.get('ADMIN_SMTP_USER', { infer: true }) || undefined,
      password: this.config.get('ADMIN_SMTP_PASSWORD', { infer: true }) || undefined
    };
  }

  /** Front-end page a mail link opens; the token is read and removed from the URL by the page. */
  linkUrl(path: '/auth/firstLogin' | '/auth/reset', token: string): string {
    const url = new URL(path, this.webOrigin);
    url.searchParams.set('token', token);
    return url.toString();
  }
}
