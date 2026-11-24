import { invalidLinkMessage } from '../services/tokens.js';

export class ApiError extends Error {
  constructor(status, code, message, data = null, redirectTo) {
    super(message); Object.assign(this, { status, code, data, redirectTo });
  }
}
export function reply(response, status, code, message, data = null, redirectTo) {
  return response.status(status).json({ success: status < 400, code, message, data, ...(redirectTo ? { redirectTo } : {}) });
}
export function databaseError(error) {
  if (error instanceof ApiError) return error;
  if (error.errno === 1062 || error.code === 'ER_DUP_ENTRY') {
    // Only inspect constraint names. Never expose SQL or submitted values.
    const constraint = String(error.sqlMessage || error.message).match(/for key ['`]([^'`]+)['`]/i)?.[1]?.split('.').at(-1);
    if (constraint === 'uq_users_email') return new ApiError(409, 'EMAIL_ALREADY_USED', 'Email đã được sử dụng.', { errors: { email: 'Email đã được sử dụng.' } });
    if (constraint === 'uq_users_phone') return new ApiError(409, 'PHONE_ALREADY_USED', 'Số điện thoại đã được sử dụng.', { errors: { phone: 'Số điện thoại đã được sử dụng.' } });
    return new ApiError(409, 'ACCOUNT_ALREADY_EXISTS', 'Email hoặc số điện thoại đã được sử dụng.');
  }
  const codes = {
    AUTH_LOGIN_AGAIN: [401, 'LOGIN_AGAIN', 'Thông tin đăng nhập đã thay đổi. Vui lòng đăng nhập lại.'],
    AUTH_ACCOUNT_NOT_FOUND: [404, 'ACCOUNT_NOT_FOUND', 'Email hoặc số điện thoại chưa đăng ký.'],
    AUTH_INVALID_RESET_TOKEN: [400, 'INVALID_RESET_TOKEN', invalidLinkMessage],
    AUTH_INVALID_EMAIL: [400, 'INVALID_EMAIL', 'Địa chỉ email không hợp lệ.'],
    AUTH_INVALID_PHONE_E164: [400, 'INVALID_PHONE', 'Số điện thoại không hợp lệ.'],
    ONBOARDING_PROFILE_REQUIRED: [400,'ONBOARDING_PROFILE_REQUIRED','Vui lòng lưu đầy đủ thông tin hồ sơ hợp lệ.'],
    ONBOARDING_INVALID_BIRTH_DATE: [400,'ONBOARDING_INVALID_BIRTH_DATE','Ngày sinh không hợp lệ.'],
    ONBOARDING_INVALID_INCOME: [400,'ONBOARDING_INVALID_INCOME','Thu nhập hàng tháng không hợp lệ.'],
    ONBOARDING_INVALID_PURPOSE: [400,'ONBOARDING_INVALID_PURPOSE','Mục đích sử dụng hoặc mô tả chưa hợp lệ.'],
    ONBOARDING_CONTACT_NOT_VERIFIED: [400,'ONBOARDING_CONTACT_NOT_VERIFIED','Vui lòng xác thực ít nhất email hoặc số điện thoại.'],
    VERIFY_ALREADY_VERIFIED: [409,'VERIFY_ALREADY_VERIFIED','Kênh liên hệ này đã được xác thực. Vui lòng tải lại trạng thái.'],
    VERIFY_CONTACT_CHANGED: [409,'VERIFY_CONTACT_CHANGED','Thông tin liên hệ đã thay đổi. Vui lòng gửi mã mới.'],
  };
  const mapped = codes[error.sqlMessage || error.message];
  if (mapped) return new ApiError(...mapped, null, mapped[1] === 'ACCOUNT_NOT_FOUND' ? '/login' : undefined);
  return new ApiError(503, 'SERVICE_UNAVAILABLE', 'Chưa thể xử lý yêu cầu. Vui lòng thử lại sau.');
}
export function errorHandler(error, request, response, next) {
  if (response.headersSent) return next(error);
  const mapped = error.status === 413 ? new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Dữ liệu gửi lên quá dài.')
    : error.type === 'entity.parse.failed' ? new ApiError(400, 'INVALID_JSON', 'Dữ liệu JSON không hợp lệ.') : databaseError(error);
  if (mapped.code === 'SERVICE_UNAVAILABLE' && request.method === 'POST' && request.path === '/api/onboarding/verification/send') {
    const code = typeof error.code === 'string' && /^[A-Z0-9_]{1,80}$/.test(error.code) ? error.code : 'UNKNOWN';
    console.error('[onboarding] verification_request_failed', { code, errno: Number.isInteger(error.errno) ? error.errno : undefined });
  }
  if (mapped.data?.retryAfter) response.set('Retry-After',String(mapped.data.retryAfter));
  return reply(response, mapped.status, mapped.code, mapped.message, mapped.data, mapped.redirectTo);
}
