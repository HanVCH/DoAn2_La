import { reply, databaseError } from '../middleware/errors.js';
import { recoveryInput } from '../validators/auth.js';
import { hashToken } from '../services/tokens.js';
import { sessionCookieOptions } from '../middleware/auth.js';
import { accountLimit } from '../middleware/security.js';

export function createRecoveryController({ service, config, limiter }) {
  const pageData = { supportEmail: config.supportEmail, tokenTtlMinutes: 15, token: '', message: '' };
  return {
    showForgot(_request, response) { response.render('recovery', { ...pageData, state: 'request' }); },
    async sendEmail(request, response) {
      const input = recoveryInput(request.body?.identifier);
      accountLimit(limiter, response, `forgot-account:${hashToken(input.value)}`, 5, 60 * 60000);
      const data = await service.requestReset(input.value);
      return reply(response, 200, 'PASSWORD_RESET_EMAIL_SENT', 'Đã gửi liên kết đặt lại mật khẩu qua email.', data);
    },
    async validate(request, response) {
      await service.verify(request.query.token);
      return reply(response, 200, 'RESET_TOKEN_VALID', 'Liên kết hợp lệ.', { valid: true });
    },
    async showReset(request, response) {
      try {
        await service.verify(request.query.token);
        response.render('recovery', { ...pageData, state: 'reset', token: request.query.token });
      } catch (error) {
        const mapped = databaseError(error);
        response.status(mapped.status).render('recovery', { ...pageData, state: 'invalid', message: mapped.message });
      }
    },
    async savePassword(request, response) {
      await service.resetPassword(request.body?.token, request.body?.newPassword ?? request.body?.password, request.body?.confirmPassword ?? request.body?.passwordConfirmation);
      response.clearCookie('la_session', sessionCookieOptions(config));
      return reply(response, 200, 'PASSWORD_RESET_SUCCESS', 'Đổi mật khẩu thành công. Vui lòng đăng nhập bằng mật khẩu mới.', null, '/login');
    },
  };
}
