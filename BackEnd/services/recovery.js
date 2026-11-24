import { hashPassword } from './passwords.js';
import { createToken, hashToken, findResetToken, invalidLinkMessage, validTokenFormat } from './tokens.js';
import { recoveryInput, passwordInput } from '../validators/auth.js';
import { checkIdentifier, loginMessages } from '../controllers/auth-controller.js';
import { ApiError } from '../middleware/errors.js';

export function createRecoveryService({ db, config, mailer }) {
  function available() {
    if (config.externalAuth) throw new ApiError(503, 'EXTERNAL_RECOVERY_UNAVAILABLE', 'Chưa cấu hình khôi phục cho dịch vụ đăng nhập ngoài.');
  }
  return {
    async requestReset(identifier) {
      available();
      const input = recoveryInput(identifier);
      const result = await checkIdentifier(db, input);
      if (['EMAIL_NOT_REGISTERED', 'PHONE_NOT_REGISTERED'].includes(result.code)) throw new ApiError(404, 'ACCOUNT_NOT_FOUND', 'Email hoặc số điện thoại chưa đăng ký.', null, '/login');
      if (result.code !== 'PASSWORD_REQUIRED') throw new ApiError(result.code === 'ACCOUNT_DISABLED' ? 403 : 409, result.code, loginMessages[result.code]);
      if (!mailer.ready) throw new ApiError(503, 'MAIL_NOT_CONFIGURED', 'Dịch vụ gửi email chưa được cấu hình. Vui lòng cấu hình SMTP và MAIL_FROM.');
      const raw = createToken();
      const [issued] = await db.call('la_auth_issue_password_reset', [input.value, hashToken(raw), 15]);
      if (!issued) throw new Error('Missing reset result');
      try { await mailer.sendReset(issued.email, raw); }
      catch {
        // Revoke exactly this issuance, even if a concurrent request issued another.
        await db.execute('UPDATE password_reset_tokens SET revoked_at = UTC_TIMESTAMP(6) WHERE id = ? AND used_at IS NULL AND revoked_at IS NULL', [String(issued.reset_id)]);
        throw new ApiError(502, 'MAIL_SEND_FAILED', 'Chưa thể gửi email. Vui lòng thử lại sau.');
      }
      const [local, domain] = issued.email.split('@');
      return { sent: true, maskedEmail: `${local[0]}***@${domain}`, retryAfter: 60 };
    },
    async verify(raw) {
      available();
      const record = await findResetToken(db, raw);
      if (!record) throw new ApiError(400, 'INVALID_RESET_TOKEN', invalidLinkMessage);
      return record;
    },
    async resetPassword(raw, password, confirmation) {
      available();
      if (!validTokenFormat(raw)) throw new ApiError(400, 'INVALID_RESET_TOKEN', invalidLinkMessage);
      passwordInput(password, confirmation);
      await this.verify(raw);
      const encoded = await hashPassword(password);
      // Final validation, locking, one-time use and revocation are atomic in SQL.
      const [result] = await db.call('la_auth_reset_password', [hashToken(raw), encoded]);
      if (!result) throw new Error('Missing reset result');
      return { user_id: String(result.user_id) };
    },
  };
}
