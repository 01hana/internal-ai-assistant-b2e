import { AdminSettings } from '../../src/admin/config/admin-settings';
import { AdminMailService } from '../../src/admin/mail/admin-mail.service';
import type { AdminMailMessage, AdminMailTransport } from '../../src/admin/mail/admin-mail.transport';

/** Feature 014 Phase 2 (T009): invitation and reset mail content; delivery failures do not throw. */
const settings = Object.create(AdminSettings.prototype) as AdminSettings;
Object.defineProperty(settings, 'webOrigin', { get: () => 'https://admin.example.test' });

class RecordingTransport implements AdminMailTransport {
  readonly sent: AdminMailMessage[] = [];
  fail = false;
  async send(message: AdminMailMessage) {
    if (this.fail) throw new Error('smtp down: user=secret pass=secret');
    this.sent.push(message);
  }
}

const recipient = { account: 'ops.admin', name: '王小明', email: 'ops@example.test' };
const token = 'A'.repeat(43);
const expiresAt = new Date('2026-11-21T02:00:00.000Z');

describe('admin mail', () => {
  it('sends an invitation with the first-login link, the account and the expiry, and no password', async () => {
    const transport = new RecordingTransport();
    await expect(new AdminMailService(settings, transport).sendInvitation(recipient, token, expiresAt)).resolves.toBe(true);
    const [message] = transport.sent;
    expect(message.to).toBe('ops@example.test');
    // The exact body: the link, the account and the expiry, and nothing else (no password can appear).
    expect(message.text).toBe([
      '王小明 您好：',
      '已為您建立後台帳號「ops.admin」。請在 2026/11/21 10:00 前點擊以下連結設定密碼：',
      `https://admin.example.test/auth/firstLogin?token=${token}`,
      '此連結只能使用一次。若連結失效，請聯絡您的管理者重新寄送。'
    ].join('\n\n'));
    expect(message.html).toContain(`href="https://admin.example.test/auth/firstLogin?token=${token}"`);
  });

  it('sends a reset mail with the reset link', async () => {
    const transport = new RecordingTransport();
    await new AdminMailService(settings, transport).sendPasswordReset(recipient, token, expiresAt);
    expect(transport.sent[0].text).toContain(`https://admin.example.test/auth/reset?token=${token}`);
    expect(transport.sent[0].text).toContain('若不是您本人申請');
  });

  it('escapes HTML in names', async () => {
    const transport = new RecordingTransport();
    await new AdminMailService(settings, transport).sendInvitation({ ...recipient, name: '<script>x</script>' }, token, expiresAt);
    expect(transport.sent[0].html).not.toContain('<script>');
    expect(transport.sent[0].html).toContain('&lt;script&gt;');
  });

  it('reports a delivery failure as false', async () => {
    const transport = new RecordingTransport();
    transport.fail = true;
    await expect(new AdminMailService(settings, transport).sendInvitation(recipient, token, expiresAt)).resolves.toBe(false);
  });
});
