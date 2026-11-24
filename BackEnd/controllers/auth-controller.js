import { hashPassword, verifyPassword } from '../services/passwords.js';
import { createToken, hashToken, validTokenFormat } from '../services/tokens.js';
import { readCookie, accountLimit } from '../middleware/security.js';
import { sessionCookieOptions } from '../middleware/auth.js';
import { ApiError, reply } from '../middleware/errors.js';
import { identifierInput, registrationInput } from '../validators/auth.js';
import { safeUser } from '../models/users.js';
import { getOnboardingState, onboardingRedirect } from '../services/onboarding.js';
import { readPreferences } from '../services/preferences.js';

const authState = (user, state) => ({ user: safeUser(user), needs_onboarding: state.needs_onboarding, onboarding_completed_at: state.onboarding_completed_at, profile_complete: state.profile_complete, contact_verified: state.contact_verified, email_verified_at: state.email_verified_at, phone_verified_at: state.phone_verified_at });

export const loginMessages = {
  EMAIL_NOT_REGISTERED: 'Email chưa đăng ký.',
  PHONE_NOT_REGISTERED: 'Số điện thoại chưa đăng ký.',
  PASSWORD_REQUIRED: 'Tài khoản đã đăng ký. Vui lòng nhập mật khẩu.',
  ACCOUNT_DISABLED: 'Tài khoản đã bị khóa. Vui lòng liên hệ hỗ trợ.',
  PASSWORD_NOT_SET: 'Tài khoản chưa có mật khẩu. Vui lòng dùng cách đăng nhập Google hoặc Facebook đã liên kết.',
  INVALID_IDENTIFIER_TYPE: 'Vui lòng chọn đăng nhập bằng email hoặc số điện thoại.',
  INVALID_EMAIL: 'Địa chỉ email không hợp lệ.',
  INVALID_PHONE: 'Số điện thoại không hợp lệ.',
  EMAIL_REQUIRED: 'Vui lòng nhập email.',
  PHONE_REQUIRED: 'Vui lòng nhập số điện thoại.',
};
export async function checkIdentifier(db, input) {
  const [result] = await db.call('la_auth_check_login_identifier', [input.type, input.value]);
  if (!result || !Object.hasOwn(loginMessages, result.code)) throw new Error('Unexpected login check result');
  return result;
}
export function createAuthController({ db, config, limiter }) {
  return {
    async register(request, response) {
      const input = registrationInput(request.body || {});
      const encoded = await hashPassword(input.password);
      const [user] = await db.call('la_auth_register', [input.email, input.phone, encoded]);
      if (!user) throw new Error('Missing registration result');
      return reply(response, 201, 'REGISTER_SUCCESS', 'Đăng ký thành công. Vui lòng đăng nhập.', { user: safeUser(user) }, '/login');
    },
    async check(request, response) {
      const input = identifierInput(request.body?.type, request.body?.identifier);
      const result = await checkIdentifier(db, input);
      const status = result.code === 'ACCOUNT_DISABLED' ? 403 : /^(INVALID_|EMAIL_REQUIRED|PHONE_REQUIRED)/.test(result.code) ? 400 : 200;
      return reply(response, status, result.code, loginMessages[result.code], { allow_password: Boolean(Number(result.allow_password)) });
    },
    async login(request, response) {
      // Keep compatibility with the existing email form; canonical clients send type/identifier.
      const input = identifierInput(request.body?.type ?? (request.body?.email ? 'email' : undefined), request.body?.identifier ?? request.body?.email);
      const password = request.body?.password;
      accountLimit(limiter, response, `login-account:${hashToken(input.value)}`, 20, 15 * 60000);
      const [user] = await db.call('la_auth_get_login_user_by_identifier', [input.type, input.value]);
      if (!user) {
        const check = await checkIdentifier(db, input);
        const status = check.code === 'ACCOUNT_DISABLED' ? 403 : 401;
        throw new ApiError(status, check.code === 'PASSWORD_REQUIRED' ? 'LOGIN_AGAIN' : check.code, loginMessages[check.code]);
      }
      if (!await verifyPassword(password, user.password_hash)) throw new ApiError(401, 'INVALID_PASSWORD', 'Mật khẩu không đúng.');
      const raw = createToken();
      // Procedure owns its transaction and rechecks auth_version under a user lock.
      const [session] = await db.call('la_auth_create_session', [String(user.id), user.auth_version, hashToken(raw), config.sessionTtlMinutes]);
      if (!session) throw new Error('Missing session result');
      const expires = new Date(session.expires_at);
      if (!Number.isFinite(expires.getTime())) throw new Error('Invalid session expiry');
      const state = await getOnboardingState(db,user.id);
      response.cookie('la_session', raw, { ...sessionCookieOptions(config), expires });
      return reply(response, 200, 'LOGIN_SUCCESS', 'Đăng nhập thành công.', authState(user,state), onboardingRedirect(config,state));
    },
    async me(request, response) {
      const state = await getOnboardingState(db,request.authUser.id);
      const preferences = await readPreferences(db,request.authUser.id);
      return reply(response, 200, 'AUTHENTICATED', 'Phiên đăng nhập hợp lệ.', {...authState(request.authUser,state),preferences}, onboardingRedirect(config,state));
    },
    async logout(request, response) {
      const raw = readCookie(request, 'la_session');
      if (validTokenFormat(raw)) await db.execute('UPDATE auth_sessions SET revoked_at = UTC_TIMESTAMP(6) WHERE token_hash = ? AND revoked_at IS NULL', [hashToken(raw)]);
      response.clearCookie('la_session', sessionCookieOptions(config));
      return reply(response, 200, 'LOGOUT_SUCCESS', 'Đã đăng xuất.');
    },
  };
}
