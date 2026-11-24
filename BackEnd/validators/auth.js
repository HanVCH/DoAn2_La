import { normalizeEmail, normalizePhone, validEmail, validPhone, passwordError, parseIdentifier } from '../../shared/auth-policy.mjs';
import { ApiError } from '../middleware/errors.js';

export function identifierInput(type, identifier) {
  if (!['email', 'phone'].includes(type)) throw new ApiError(400, 'INVALID_IDENTIFIER_TYPE', 'Vui lòng chọn đăng nhập bằng email hoặc số điện thoại.');
  const value = type === 'email' ? normalizeEmail(identifier) : normalizePhone(identifier);
  if (!(type === 'email' ? validEmail(value) : validPhone(value))) throw new ApiError(400, type === 'email' ? 'INVALID_EMAIL' : 'INVALID_PHONE', type === 'email' ? 'Địa chỉ email không hợp lệ.' : 'Số điện thoại không hợp lệ.');
  return { type, value };
}
export function recoveryInput(value) {
  const parsed = parseIdentifier(value);
  if (parsed.error) throw new ApiError(400, 'INVALID_IDENTIFIER', parsed.error, { errors: { identifier: parsed.error } });
  return parsed;
}
export function passwordInput(password, confirmation) {
  const errors = {};
  const policy = passwordError(password);
  if (policy) errors.password = policy;
  if (typeof confirmation !== 'string' || confirmation !== password) errors.confirmPassword = 'Mật khẩu nhập lại chưa trùng khớp.';
  if (Object.keys(errors).length) throw new ApiError(400, 'INVALID_PASSWORD_INPUT', 'Vui lòng kiểm tra mật khẩu.', { errors });
  return password;
}
export function registrationInput(body) {
  const email = identifierInput('email', body.email).value;
  const phone = identifierInput('phone', body.phone).value;
  const password = passwordInput(body.password, body.confirmPassword ?? body.passwordConfirmation);
  return { email, phone, password };
}
