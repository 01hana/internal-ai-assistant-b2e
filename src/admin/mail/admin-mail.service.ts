import { Inject, Injectable, Logger } from '@nestjs/common';
import { AdminSettings } from '../config/admin-settings';
import { ADMIN_MAIL_TRANSPORT, type AdminMailMessage, type AdminMailTransport } from './admin-mail.transport';

type Recipient = { account: string; name: string; email: string };

/**
 * Feature 014: invitation and password-reset mail. Messages contain only the link, the account and
 * the expiry — never a password. Sending failures are reported to the caller, not thrown.
 */
@Injectable()
export class AdminMailService {
  private readonly logger = new Logger(AdminMailService.name);

  constructor(private readonly settings: AdminSettings, @Inject(ADMIN_MAIL_TRANSPORT) private readonly transport: AdminMailTransport) {}

  sendInvitation(recipient: Recipient, token: string, expiresAt: Date): Promise<boolean> {
    const link = this.settings.linkUrl('/auth/firstLogin', token);
    return this.deliver({
      to: recipient.email,
      subject: '後台帳號開通：請設定您的密碼',
      ...render([
        `${recipient.name} 您好：`,
        `已為您建立後台帳號「${recipient.account}」。請在 ${formatTime(expiresAt, this.settings.timeZone)} 前點擊以下連結設定密碼：`,
        link,
        '此連結只能使用一次。若連結失效，請聯絡您的管理者重新寄送。'
      ], link)
    });
  }

  sendPasswordReset(recipient: Recipient, token: string, expiresAt: Date): Promise<boolean> {
    const link = this.settings.linkUrl('/auth/reset', token);
    return this.deliver({
      to: recipient.email,
      subject: '後台帳號：重設密碼',
      ...render([
        `${recipient.name} 您好：`,
        `我們收到後台帳號「${recipient.account}」的重設密碼申請。請在 ${formatTime(expiresAt, this.settings.timeZone)} 前點擊以下連結設定新密碼：`,
        link,
        '此連結只能使用一次。若不是您本人申請，請忽略這封信，您的密碼不會改變。'
      ], link)
    });
  }

  private async deliver(message: AdminMailMessage): Promise<boolean> {
    try {
      await this.transport.send(message);
      return true;
    } catch (error) {
      // Never log the message body (it contains the link) or SMTP credentials.
      this.logger.warn(`Mail delivery failed: ${error instanceof Error ? error.name : 'unknown error'}`);
      return false;
    }
  }
}

function render(lines: string[], link: string): { text: string; html: string } {
  const text = lines.join('\n\n');
  const html = lines
    .map((line) => (line === link ? `<p><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>` : `<p>${escapeHtml(line)}</p>`))
    .join('\n');
  return { text, html };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

/**
 * `2026/11/21 10:00` in the deployment's time zone. Assembled from parts: ICU versions differ in the separators
 * `format()` puts between date and time (a thin space in newer Node releases).
 */
function formatTime(value: Date, timeZone: string): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(value).map((part) => [part.type, part.value]));
  return `${parts.year}/${parts.month}/${parts.day} ${parts.hour}:${parts.minute}`;
}
