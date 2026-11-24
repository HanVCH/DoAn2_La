import { csrfHeaders } from './auth-api.js';
import { setupAuthUI } from './auth-ui.js';
import { parseIdentifier } from './auth-policy.mjs';

const form = document.querySelector('#login-form');
const status = document.querySelector('#form-status');
const button = document.querySelector('#submit-button');
const label = document.querySelector('[data-submit-label]');
const spinner = document.querySelector('.loading-spinner');
const passwordStep = document.querySelector('#password-step');
let checkedIdentifier = '', submitting = false, completed = false;

function showStatus(message, state = 'error') {
  status.textContent = message; status.dataset.state = state; status.hidden = false;
}
function setError(name, message) {
  form.elements[name].setAttribute('aria-invalid', String(Boolean(message)));
  const error = document.querySelector(`#${name}-error`);
  error.textContent = message; error.hidden = !message;
}
setupAuthUI(showStatus);
form.elements.email.addEventListener('input', () => {
  checkedIdentifier = ''; passwordStep.hidden = true; form.elements.password.value = '';
  label.textContent = 'Tiếp tục'; status.hidden = true; setError('email', ''); setError('password', '');
});
form.elements.password.addEventListener('input', () => { status.hidden = true; setError('password', ''); });
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (submitting || completed) return;
  const input = parseIdentifier(form.elements.email.value);
  if (input.error) { setError('email', input.error); form.elements.email.focus(); return; }
  const key = `${input.type}:${input.value}`;
  const checking = checkedIdentifier !== key;
  if (!checking && !form.elements.password.value) { setError('password', 'Vui lòng nhập mật khẩu.'); form.elements.password.focus(); return; }
  const submittedPassword = form.elements.password.value;
  if (!checking) form.elements.email.readOnly = true;
  submitting = true; button.disabled = true; form.setAttribute('aria-busy', 'true'); spinner.hidden = false;
  label.textContent = checking ? 'Đang kiểm tra…' : 'Đang đăng nhập…'; status.hidden = true;
  try {
    const response = await fetch(checking ? '/api/auth/login/check' : '/api/auth/login', {
      method: 'POST', headers: csrfHeaders(), credentials: 'include', cache: 'no-store',
      signal: AbortSignal.timeout(20000), body: JSON.stringify({ type: input.type, identifier: input.value, ...(!checking ? { password: submittedPassword } : {}) }),
    });
    const data = await response.json();
    // Ignore a response for an identifier that was edited during the request.
    const current = parseIdentifier(form.elements.email.value);
    if (`${current.type}:${current.value}` !== key) return;
    if (checking && response.ok && data.data?.allow_password) {
      checkedIdentifier = key; passwordStep.hidden = false; form.elements.password.focus();
    } else if (!checking && response.ok) {
      // /me decides routing using the current database state, also across tabs.
      const meResponse = await fetch('/api/auth/me',{credentials:'include',cache:'no-store'});
      const me = await meResponse.json();
      if (!meResponse.ok) throw new Error('Session unavailable');
      completed = true;
      const destination = me.data.needs_onboarding ? '/onboarding' : me.redirectTo;
      if (typeof destination === 'string' && destination.startsWith('/') && !destination.startsWith('//') && !/[\\\s\u0000-\u001f]/.test(destination)) window.location.assign(destination);
    } else {
      if (data.code === 'LOGIN_AGAIN') { checkedIdentifier = ''; passwordStep.hidden = true; form.elements.password.value = ''; }
      showStatus(data.message || 'Chưa thể đăng nhập. Vui lòng thử lại sau.');
    }
  } catch { showStatus('Không thể kết nối máy chủ. Vui lòng kiểm tra kết nối và thử lại.'); }
  finally {
    submitting = false; button.disabled = completed; spinner.hidden = true; form.setAttribute('aria-busy', 'false');
    form.elements.email.readOnly = false;
    label.textContent = completed ? 'Đã đăng nhập' : checkedIdentifier ? 'Đăng nhập' : 'Tiếp tục';
  }
});
