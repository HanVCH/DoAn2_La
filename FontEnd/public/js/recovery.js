import { setupAuthUI } from './auth-ui.js';
import { csrfHeaders } from './auth-api.js';
import { parseIdentifier, passwordError } from './auth-policy.mjs';

const panel = document.querySelector('.recovery-panel');
const status = document.querySelector('#form-status');
const requestForm = document.querySelector('#recovery-request-form');
const resetForm = document.querySelector('#recovery-reset-form');
const resendButton = document.querySelector('#resend-button');
let sending = false;
let completed = false;
let retryAt = 0;
let lastIdentifier = '';

function showStatus(message, state = 'error') {
  status.textContent = message;
  status.dataset.state = state;
  status.hidden = false;
}
setupAuthUI(showStatus);
function setError(name, message) {
  const input = document.getElementById(name);
  input.setAttribute('aria-invalid', String(Boolean(message)));
  const error = document.getElementById(`${name}-error`);
  error.textContent = message;
  error.hidden = !message;
}
function busy(form, value, loadingLabel, defaultLabel) {
  sending = value;
  form.setAttribute('aria-busy', String(value));
  form.querySelector('[type="submit"]').disabled = value || completed;
  form.querySelector('[data-submit-label]').textContent = value ? loadingLabel : defaultLabel;
  form.querySelector('.loading-spinner').hidden = !value;
}
async function post(url, data) {
  const response = await fetch(url, { method: 'POST', headers: csrfHeaders(), credentials: 'include', body: JSON.stringify(data), signal: AbortSignal.timeout(45000), cache: 'no-store' });
  const result = await response.json();
  return { response, data: { ...result, ...result.data, errors: result.data?.errors || result.errors, invalidToken: result.code === 'INVALID_RESET_TOKEN' } };
}
function updateCooldown() {
  if (!resendButton) return;
  const remaining = Math.max(0, Math.ceil((retryAt - Date.now()) / 1000));
  resendButton.disabled = sending || remaining > 0;
  resendButton.textContent = sending ? 'Đang gửi email…' : remaining ? `Gửi lại email (${remaining}s)` : 'Gửi lại email';
}
if (requestForm) {
  const touched = new Set();
  const identifierInput = requestForm.elements.identifier;
  identifierInput.addEventListener('blur', () => {
    touched.add('identifier');
    setError('identifier', parseIdentifier(identifierInput.value).error || '');
  });
  identifierInput.addEventListener('input', () => {
    if (touched.has('identifier')) setError('identifier', parseIdentifier(identifierInput.value).error || '');
    status.hidden = true;
    document.querySelector('#recovery-support').hidden = true;
  });
  async function sendEmail(isResend = false) {
    if (sending) return;
    const identifier = isResend ? lastIdentifier : identifierInput.value;
    const parsed = parseIdentifier(identifier);
    if (parsed.error) { setError('identifier', parsed.error); identifierInput.focus(); return; }
    touched.add('identifier');
    setError('identifier', '');
    status.hidden = true;
    busy(requestForm, true, 'Đang gửi liên kết…', 'Gửi liên kết xác thực');
    updateCooldown();
    try {
      const { response, data } = await post('/forgot-password', { identifier });
      if (data.redirectTo) { window.location.assign(data.redirectTo); return; }
      if (response.ok && data.sent) {
        lastIdentifier = identifier;
        document.querySelector('#request-state').hidden = true;
        document.querySelector('#sent-state').hidden = false;
        document.querySelector('#masked-email').textContent = data.maskedEmail;
        panel.setAttribute('aria-labelledby', 'sent-title');
        document.querySelector('#sent-title').focus();
        retryAt = Date.now() + (data.retryAfter || 60) * 1000;
        if (isResend) showStatus('Email xác thực đã được gửi lại.', 'success');
      } else {
        if (data.errors?.identifier) setError('identifier', data.errors.identifier);
        if (data.retryAfter) retryAt = Date.now() + data.retryAfter * 1000;
        showStatus(data.message || 'Chưa thể gửi email. Vui lòng thử lại sau.');
        document.querySelector('#recovery-support').hidden = !data.needsSupport;
      }
    } catch {
      showStatus('Không thể gửi yêu cầu. Vui lòng kiểm tra kết nối và thử lại.');
    } finally {
      busy(requestForm, false, '', 'Gửi liên kết xác thực');
      updateCooldown();
    }
  }
  requestForm.addEventListener('submit', event => { event.preventDefault(); sendEmail(); });
  resendButton.addEventListener('click', () => { if (Date.now() >= retryAt) sendEmail(true); });
  document.querySelector('#change-identifier').addEventListener('click', () => {
    document.querySelector('#sent-state').hidden = true;
    document.querySelector('#request-state').hidden = false;
    panel.setAttribute('aria-labelledby', 'recovery-title');
    status.hidden = true;
    identifierInput.focus();
  });
  setInterval(updateCooldown, 1000);
}
if (resetForm) {
  // Remove the raw token from the address bar/history entry; keep it only in this form.
  history.replaceState(null, '', '/reset-password');
  const touched = new Set();
  function errorFor(name) {
    if (name === 'password') return passwordError(resetForm.elements.password.value);
    const value = resetForm.elements.passwordConfirmation.value;
    if (!value) return 'Vui lòng nhập lại mật khẩu mới.';
    return value === resetForm.elements.password.value ? '' : 'Mật khẩu nhập lại chưa trùng khớp.';
  }
  for (const name of ['password', 'passwordConfirmation']) {
    const input = resetForm.elements.namedItem(name);
    input.addEventListener('blur', () => { touched.add(name); setError(name, errorFor(name)); });
    input.addEventListener('input', () => {
      if (touched.has(name)) setError(name, errorFor(name));
      if (name === 'password' && touched.has('passwordConfirmation')) setError('passwordConfirmation', errorFor('passwordConfirmation'));
      status.hidden = true;
    });
  }
  resetForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (sending || completed) return;
    let firstInvalid;
    for (const name of ['password', 'passwordConfirmation']) {
      touched.add(name);
      const error = errorFor(name);
      setError(name, error);
      if (error && !firstInvalid) firstInvalid = resetForm.elements.namedItem(name);
    }
    if (firstInvalid) { firstInvalid.focus(); return; }
    busy(resetForm, true, 'Đang lưu mật khẩu…', 'Lưu mật khẩu mới');
    status.hidden = true;
    try {
      const { response, data } = await post('/reset-password', {
        token: resetForm.elements.token.value,
        password: resetForm.elements.password.value,
        passwordConfirmation: resetForm.elements.passwordConfirmation.value,
      });
      if (response.ok && data.redirectTo) { completed = true; window.location.assign(data.redirectTo); return; }
      for (const [name, message] of Object.entries(data.errors || {})) {
        if (['password', 'passwordConfirmation'].includes(name)) setError(name, message);
      }
      showStatus(data.message || 'Chưa thể lưu mật khẩu. Vui lòng thử lại sau.');
      if (data.invalidToken) {
        completed = true;
        const link = document.createElement('a');
        link.href = '/forgot-password'; link.className = 'button login-button request-new-link'; link.textContent = 'Yêu cầu liên kết mới';
        status.after(link);
      }
    } catch { showStatus('Không thể gửi yêu cầu. Vui lòng kiểm tra kết nối và thử lại.'); }
    finally { busy(resetForm, false, '', 'Lưu mật khẩu mới'); }
  });
}
