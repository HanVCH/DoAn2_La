// Same-origin adapter. Replace API integration in FontEnd/integrations/auth.js.
export function csrfHeaders() {
  return { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]')?.content || '' };
}
export async function registerAccount(payload) {
  const response = await fetch('/api/auth/register', {
    method: 'POST',
    headers: csrfHeaders(),
    credentials: 'include',
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20000),
  });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, data };
}

export async function loginAccount(payload) {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: csrfHeaders(),
    credentials: 'include',
    cache: 'no-store',
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20000),
  });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, statusCode: response.status, data };
}

export async function startSocialAuth(provider) {
  const response = await fetch(`/auth/${encodeURIComponent(provider)}`, { redirect: 'manual' });
  if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
    window.location.assign(`/auth/${encodeURIComponent(provider)}`);
    return;
  }
  const data = await response.json().catch(() => ({}));
  throw new Error(data.message || 'Chưa thể kết nối dịch vụ đăng nhập. Vui lòng thử lại sau.');
}
