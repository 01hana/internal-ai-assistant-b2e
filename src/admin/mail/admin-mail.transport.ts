import { Logger } from '@nestjs/common';
import { createTransport } from 'nodemailer';
import type { SmtpSettings } from '../config/admin-settings';

export type AdminMailMessage = { to: string; subject: string; text: string; html: string };

/** How mail leaves the admin API. Swapped for a recording transport in tests. */
export interface AdminMailTransport {
  send(message: AdminMailMessage): Promise<void>;
}

export const ADMIN_MAIL_TRANSPORT = Symbol('ADMIN_MAIL_TRANSPORT');

export class SmtpMailTransport implements AdminMailTransport {
  private readonly transporter;

  constructor(private readonly from: string, smtp: SmtpSettings) {
    this.transporter = createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      ...(smtp.user ? { auth: { user: smtp.user, pass: smtp.password ?? '' } } : {})
    });
  }

  async send(message: AdminMailMessage): Promise<void> {
    await this.transporter.sendMail({ from: this.from, ...message });
  }
}

/**
 * Local development only (rejected in production by the environment validation): writes the
 * recipient, subject and body (which contains the link) to the log instead of sending.
 */
export class LogMailTransport implements AdminMailTransport {
  private readonly logger = new Logger('AdminMail');

  async send(message: AdminMailMessage): Promise<void> {
    this.logger.log(`[mail not sent: ADMIN_MAIL_TRANSPORT=log] to=${message.to} subject=${message.subject}\n${message.text}`);
  }
}
