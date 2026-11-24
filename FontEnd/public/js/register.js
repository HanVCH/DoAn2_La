import { registerAccount } from './auth-api.js';
import { setupAuthUI } from './auth-ui.js';
import { normalizeEmail, normalizePhone, validEmail, validPhone, passwordError } from './auth-policy.mjs';

const form = document.querySelector('#register-form');
const status = document.querySelector('#form-status');
const submitButton = document.querySelector('#submit-button');
const submitLabel = document.querySelector('[data-submit-label]');
const spinner = document.querySelector('.loading-spinner');
const fields = ['email', 'phone', 'password', 'passwordConfirmation', 'acceptedTerms'];
const touched = new Set();
let submitting = false;
let completed = false;

function getError(name) {
  const input = form.elements.namedItem(name);
  const value = input.value;
  switch (name) {
    case 'email':
      if (!value.trim()) return 'Vui lòng nhập địa chỉ email.';
      if (input.validity.typeMismatch || !validEmail(normalizeEmail(value))) return 'Vui lòng nhập địa chỉ email hợp lệ.';
      return '';
    case 'phone': {
      if (!value.trim()) return 'Vui lòng nhập số điện thoại.';
      if (!validPhone(normalizePhone(value))) return 'Vui lòng nhập số điện thoại hợp lệ (VD: 0912345678).';
      return '';
    }
    case 'password':
      return passwordError(value);
    case 'passwordConfirmation':
      if (!value) return 'Vui lòng nhập lại mật khẩu.';
      if (value !== form.elements.password.value) return 'Mật khẩu nhập lại chưa trùng khớp.';
      return '';
    case 'acceptedTerms':
      return input.checked ? '' : 'Vui lòng đồng ý với điều khoản và chính sách bảo mật.';
    default: return '';
  }
}

function setError(name, message) {
  const error = document.getElementById(`${name}-error`);
  const input = form.elements.namedItem(name);
  error.textContent = message;
  error.hidden = !message;
  input.setAttribute('aria-invalid', String(Boolean(message)));
}

function showStatus(message, state = 'error') {
  status.textContent = message;
  status.dataset.state = state;
  status.hidden = false;
}

fields.forEach((name) => {
  const input = form.elements.namedItem(name);
  input.addEventListener('blur', () => {
    touched.add(name);
    setError(name, getError(name));
  });
  input.addEventListener(input.type === 'checkbox' ? 'change' : 'input', () => {
    if (touched.has(name)) setError(name, getError(name));
    if (name === 'password' && touched.has('passwordConfirmation')) setError('passwordConfirmation', getError('passwordConfirmation'));
    if (!completed) status.hidden = true;
  });
});

setupAuthUI(showStatus);

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (submitting || completed) return;
  status.hidden = true;
  let firstInvalid;
  fields.forEach((name) => {
    touched.add(name);
    const error = getError(name);
    setError(name, error);
    if (error && !firstInvalid) firstInvalid = form.elements.namedItem(name);
  });
  if (firstInvalid) {
    firstInvalid.focus();
    return;
  }
  submitting = true;
  submitButton.disabled = true;
  form.setAttribute('aria-busy', 'true');
  submitLabel.textContent = 'Đang tạo tài khoản…';
  spinner.hidden = false;
  try {
    const { ok, data } = await registerAccount({
      email: normalizeEmail(form.elements.email.value),
      phone: normalizePhone(form.elements.phone.value),
      password: form.elements.password.value,
      confirmPassword: form.elements.passwordConfirmation.value,
      acceptedTerms: form.elements.acceptedTerms.checked,
    });
    if (ok) {
      completed = true;
      showStatus(data.message || 'Đăng ký thành công. Bạn có thể chuyển sang trang đăng nhập.', 'success');
      if (data.redirectTo === '/login') window.location.assign('/login');
    } else {
      Object.entries(data.data?.errors || data.errors || {}).forEach(([name, message]) => {
        if (name === 'confirmPassword') name = 'passwordConfirmation';
        if (fields.includes(name) && typeof message === 'string') setError(name, message);
      });
      showStatus(data.message || 'Chưa thể tạo tài khoản. Vui lòng thử lại sau.');
    }
  } catch {
    showStatus('Không thể kết nối máy chủ. Vui lòng kiểm tra kết nối và thử lại.');
  } finally {
    submitting = false;
    form.setAttribute('aria-busy', 'false');
    submitButton.disabled = completed;
    submitLabel.textContent = completed ? 'Đã tạo tài khoản' : 'Tạo tài khoản';
    spinner.hidden = true;
  }
});

