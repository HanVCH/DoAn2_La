import { DEFAULT_HOME_PATH, appPages } from '../shared/app-navigation.mjs';

function integer(env, name, fallback, min, max) {
  const value = Number(env[name] || fallback);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} phải là số nguyên ${min}–${max}.`);
  return value;
}
function origin(value, name, production) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error(`${name} phải là origin HTTP(S).`);
  if (production && url.protocol !== 'https:') throw new Error(`${name} phải dùng HTTPS khi production.`);
  return url.origin;
}
export function readConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const port = integer(env, 'PORT', 3000, 1, 65535);
  const appBaseUrl = env.APP_BASE_URL ? origin(env.APP_BASE_URL, 'APP_BASE_URL', production) : '';
  const frontendOrigin = origin(env.FRONTEND_ORIGIN || appBaseUrl || `http://localhost:${port}`, 'FRONTEND_ORIGIN', production);
  if (env.DB_NAME && env.DB_NAME !== 'qlthuchi') throw new Error('DB_NAME phải là qlthuchi.');
  if (env.COOKIE_SECURE && !['true', 'false'].includes(env.COOKIE_SECURE)) throw new Error('COOKIE_SECURE phải là true hoặc false.');
  const requestedHome = !env.HOME_PATH || env.HOME_PATH === '/' ? DEFAULT_HOME_PATH : env.HOME_PATH.replace(/\/+$/,'');
  const homePath = requestedHome.toLowerCase() === DEFAULT_HOME_PATH ? DEFAULT_HOME_PATH : requestedHome;
  if (!homePath.startsWith('/') || homePath.startsWith('//') || /[\\\s?#\u0000-\u001f]/.test(homePath) || /^\/(?:api|auth|onboarding|login|register|forgot-password|reset-password)(?:\/|$)/.test(homePath)) throw new Error('HOME_PATH phải là đường dẫn trang chủ nội bộ, khác các route xác thực/thiết lập.');
  if (appPages.some(page => page.id !== 'overview' && page.path.toLowerCase() === homePath.toLowerCase())) throw new Error('HOME_PATH không được trùng với mục điều hướng khác.');
  return {
    port, production, appBaseUrl, frontendOrigin, homePath,
    otpPepper: env.OTP_PEPPER || '',
    otpEmailProvider: env.OTP_EMAIL_PROVIDER || 'smtp',
    resend: { apiKey: env.RESEND_API_KEY || '', from: env.RESEND_FROM || '' },
    sms: { enabled: env.SMS_ENABLED === 'true', accountSid: env.SMS_TWILIO_ACCOUNT_SID || '', authToken: env.SMS_TWILIO_AUTH_TOKEN || '', from: env.SMS_TWILIO_FROM || '' },
    cookieSecure: production || env.COOKIE_SECURE === 'true' || appBaseUrl.startsWith('https:') || frontendOrigin.startsWith('https:'),
    externalAuth: Boolean(env.AUTH_REGISTER_URL || env.AUTH_LOGIN_URL),
    sessionTtlMinutes: integer(env, 'SESSION_TTL_MINUTES', 10080, 1, 43200),
    tokenTtlMs: 15 * 60000,
    database: {
      host: env.DB_HOST || '127.0.0.1', port: integer(env, 'DB_PORT', 3306, 1, 65535),
      database: 'qlthuchi', user: env.DB_USER || '', password: env.DB_PASSWORD || '',
    },
    smtp: {
      host: env.SMTP_HOST || '', port: integer(env, 'SMTP_PORT', 587, 1, 65535), secure: env.SMTP_SECURE === 'true',
      user: env.SMTP_USER || '', pass: env.SMTP_PASS || '', from: env.MAIL_FROM || '', requireTLS: env.SMTP_REQUIRE_TLS !== 'false',
    },
    supportEmail: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.SUPPORT_EMAIL || '') ? env.SUPPORT_EMAIL : '',
  };
}

