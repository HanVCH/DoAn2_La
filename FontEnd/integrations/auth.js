// Integration boundary only: the domain API and persistence belong in BackEnd/.
export const authConfig = {
  registerUrl: process.env.AUTH_REGISTER_URL || '',
  loginUrl: process.env.AUTH_LOGIN_URL || '',
  loginSuccessPath: process.env.LOGIN_SUCCESS_PATH || '',
  googleUrl: process.env.GOOGLE_AUTH_URL || '',
  facebookUrl: process.env.FACEBOOK_AUTH_URL || '',
  loginPath: process.env.LOGIN_PATH || '/login',
  forgotPasswordPath: process.env.FORGOT_PASSWORD_PATH || '/forgot-password',
};

export async function loginAccount(request, response) {
  response.set('Cache-Control', 'no-store');
  if (!authConfig.loginUrl) {
    return response.status(501).json({ message: 'Tính năng đăng nhập chưa được kết nối với máy chủ. Vui lòng thử lại sau.' });
  }
  const { email, password } = request.body || {};
  if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
    return response.status(400).json({ message: 'Gmail hoặc mật khẩu không chính xác.' });
  }
  try {
    const upstream = await fetch(authConfig.loginUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ email: email.trim(), password }),
      signal: AbortSignal.timeout(15000),
      redirect: 'error',
    });
    // Do not forward backend messages that could disclose account existence.
    if (!upstream.ok) {
      const message = [400, 401, 403, 404, 422].includes(upstream.status)
        ? 'Gmail hoặc mật khẩu không chính xác.'
        : upstream.status === 429
          ? 'Bạn đã thử đăng nhập quá nhiều lần. Vui lòng thử lại sau.'
          : 'Chưa thể đăng nhập. Vui lòng thử lại sau.';
      return response.status(upstream.status).json({ message });
    }
    // The trusted backend must issue cookies valid for the frontend's origin.
    // Tokens and credentials are never exposed in JSON or browser storage.
    const cookies = upstream.headers.getSetCookie();
    if (cookies.length) response.setHeader('Set-Cookie', cookies);
    const destination = authConfig.loginSuccessPath;
    const redirectTo = destination.startsWith('/') && !destination.startsWith('//') && !/[\\\s\u0000-\u001f]/.test(destination) ? destination : undefined;
    return response.json({ message: 'Đăng nhập thành công.', redirectTo });
  } catch {
    return response.status(502).json({ message: 'Không thể kết nối máy chủ đăng nhập. Vui lòng thử lại sau.' });
  }
}

export async function registerAccount(request, response) {
  if (!authConfig.registerUrl) {
    return response.status(501).json({
      message: 'Tính năng đăng ký chưa được kết nối với máy chủ. Vui lòng thử lại sau.',
    });
  }
  // Allowlist the payload. Never log or persist credentials in the frontend server.
  const { email, phone, password, passwordConfirmation, acceptedTerms } = request.body || {};
  try {
    const upstream = await fetch(authConfig.registerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ email, phone, password, passwordConfirmation, acceptedTerms }),
      signal: AbortSignal.timeout(15000),
      redirect: 'error',
    });
    const data = await upstream.json().catch(() => ({}));
    // Forward only presentation data, never tokens or echoed form credentials.
    return response.status(upstream.status).json({
      message: typeof data.message === 'string' ? data.message : upstream.ok
        ? 'Đăng ký thành công. Bạn có thể chuyển sang trang đăng nhập.'
        : 'Chưa thể tạo tài khoản. Vui lòng kiểm tra thông tin và thử lại.',
      errors: Object.fromEntries(
        Object.entries(data.errors || {}).filter(([field, value]) =>
          ['email', 'phone', 'password', 'passwordConfirmation', 'acceptedTerms'].includes(field) && typeof value === 'string'),
      ),
    });
  } catch {
    return response.status(502).json({ message: 'Không thể kết nối máy chủ đăng ký. Vui lòng thử lại sau.' });
  }
}

export function startSocialAuth(request, response) {
  const provider = request.params.provider;
  if (!['google', 'facebook'].includes(provider)) return response.sendStatus(404);
  const destination = provider === 'google' ? authConfig.googleUrl : authConfig.facebookUrl;
  if (!destination) {
    return response.status(501).json({ message: `Đăng nhập bằng ${provider === 'google' ? 'Google' : 'Facebook'} chưa được kết nối. Vui lòng thử lại sau.` });
  }
  try {
    const url = new URL(destination);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid auth URL');
    return response.redirect(url.href);
  } catch {
    return response.status(503).json({ message: 'Cấu hình đăng nhập chưa sẵn sàng. Vui lòng thử lại sau.' });
  }
}
