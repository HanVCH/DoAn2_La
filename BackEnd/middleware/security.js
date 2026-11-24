import { randomBytes, timingSafeEqual } from 'node:crypto';
import { ApiError } from './errors.js';

export function readCookie(request, name) {
  return (request.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`))?.slice(name.length + 1) || '';
}
export function csrfPage(config) {
  return (request, response, next) => {
    let value = readCookie(request, 'la_csrf');
    if (!/^[a-f0-9]{64}$/.test(value)) {
      value = randomBytes(32).toString('hex');
      response.cookie('la_csrf', value, { httpOnly: true, secure: config.cookieSecure, sameSite: 'lax', path: '/' });
    }
    response.locals.csrfToken = value;
    next();
  };
}
export function cors(config) {
  const allowed = new Set([config.frontendOrigin, config.appBaseUrl].filter(Boolean));
  return (request, response, next) => {
    const origin = request.get('Origin');
    response.vary('Origin');
    if (origin && !allowed.has(origin)) throw new ApiError(403, 'ORIGIN_FORBIDDEN', 'Nguồn gửi yêu cầu không được phép.');
    if (origin) {
      response.set({ 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true' });
    }
    if (request.method === 'OPTIONS') {
      response.set({ 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-CSRF-Token', 'Access-Control-Max-Age': '600' });
      return response.sendStatus(204);
    }
    next();
  };
}
export function csrfGuard(config) {
  const allowed = new Set([config.frontendOrigin, config.appBaseUrl].filter(Boolean));
  return (request, _response, next) => {
    const cookie = readCookie(request, 'la_csrf');
    const token = request.get('X-CSRF-Token') || request.body?._csrf || '';
    const origin = request.get('Origin');
    if ((origin && !allowed.has(origin)) || request.get('Sec-Fetch-Site') === 'cross-site'
      || !/^[a-f0-9]{64}$/.test(cookie) || typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)
      || !timingSafeEqual(Buffer.from(cookie), Buffer.from(token))) {
      throw new ApiError(403, 'CSRF_INVALID', 'Phiên biểu mẫu đã hết hạn. Vui lòng tải lại trang và thử lại.');
    }
    next();
  };
}
// Bounded per-process counters. Use a shared store before running multiple replicas.
export function createRateLimiter() {
  const buckets = new Map();
  let cleanupAt = 0;
  return {
    take(bucket, max, windowMs, now = Date.now()) {
      if (now >= cleanupAt) {
        for (const [key, value] of buckets) if (value.expires <= now) buckets.delete(key);
        cleanupAt = now + 60000;
      }
      let value = buckets.get(bucket);
      if (!value || value.expires <= now) {
        if (buckets.size >= 10000 && !value) return 60;
        value = { hits: 0, expires: now + windowMs }; buckets.set(bucket, value);
      }
      value.hits++;
      return value.hits > max ? Math.max(1, Math.ceil((value.expires - now) / 1000)) : 0;
    },
    middleware(name, max, windowMs) {
      return (request, response, next) => {
        const retryAfter = this.take(`${name}:${request.ip}`, max, windowMs);
        if (retryAfter) {
          response.set('Retry-After', String(retryAfter));
          throw new ApiError(429, 'RATE_LIMITED', 'Bạn đã thử quá nhiều lần. Vui lòng thử lại sau.', { retryAfter });
        }
        next();
      };
    },
  };
}
export function accountLimit(limiter, response, bucket, max, windowMs) {
  const retryAfter = limiter.take(bucket, max, windowMs);
  if (retryAfter) {
    response.set('Retry-After', String(retryAfter));
    throw new ApiError(429, 'RATE_LIMITED', 'Bạn đã thử quá nhiều lần. Vui lòng thử lại sau.', { retryAfter });
  }
}
