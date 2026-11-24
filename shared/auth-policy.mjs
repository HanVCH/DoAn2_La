// Pure validation shared with the browser; no configuration or secrets.
export function normalizeEmail(value) { return typeof value === 'string' ? value.trim().toLowerCase() : ''; }
export function validEmail(value) {
  if (typeof value !== 'string' || value.length > 254 || !/^[\x21-\x7e]+$/.test(value)) return false;
  const parts = value.split('@');
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  return local.length > 0 && local.length <= 64 && !local.startsWith('.') && !local.endsWith('.') && !local.includes('..')
    && /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(local)
    && domain.includes('.') && domain.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label));
}
export function normalizePhone(value) {
  if (typeof value !== 'string' || value.length > 254) return '';
  const compact = value.trim().replace(/[\s().-]/g, '');
  if (/^0\d{9}$/.test(compact)) return `+84${compact.slice(1)}`;
  if (/^84\d{9}$/.test(compact)) return `+${compact}`;
  return compact;
}
export function validPhone(value) { return typeof value === 'string' && /^\+[1-9]\d{7,14}$/.test(value); }
export function passwordError(value) {
  if (typeof value !== 'string' || !value) return 'Vui lòng nhập mật khẩu.';
  if ([...value].length < 8) return 'Mật khẩu cần ít nhất 8 ký tự.';
  if (new TextEncoder().encode(value).length > 72) return 'Mật khẩu không được vượt quá 72 byte UTF-8.';
  return '';
}
export function parseIdentifier(value) {
  if (typeof value !== 'string' || !value.trim()) return { error: 'Vui lòng nhập email hoặc số điện thoại.' };
  const email = normalizeEmail(value);
  if (validEmail(email)) return { type: 'email', value: email };
  const phone = normalizePhone(value);
  if (validPhone(phone)) return { type: 'phone', value: phone };
  return { error: 'Vui lòng nhập email hoặc số điện thoại hợp lệ.' };
}
