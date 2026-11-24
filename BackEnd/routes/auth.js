import { Router } from 'express';
import { createAuthController } from '../controllers/auth-controller.js';
import { createRecoveryController } from '../controllers/recovery-controller.js';
import { createRecoveryService } from '../services/recovery.js';
import { csrfGuard, createRateLimiter } from '../middleware/security.js';
import { requireAuth } from '../middleware/auth.js';
import { reply } from '../middleware/errors.js';

export function createAuthRouter({ db, config, mailer }) {
  const router = Router();
  const limiter = createRateLimiter();
  const guard = csrfGuard(config);
  const service = createRecoveryService({ db, config, mailer });
  const recovery = createRecoveryController({ service, config, limiter });
  const auth = createAuthController({ db, config, limiter });
  router.use(['/api/auth', '/forgot-password', '/reset-password'], (_request, response, next) => {
    response.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex, nofollow' });
    next();
  });
  router.get('/api/auth/csrf', (_request, response) => reply(response, 200, 'CSRF_READY', 'Biểu mẫu đã sẵn sàng.', { csrfToken: response.locals.csrfToken }));
  if (!config.externalAuth) {
    router.post('/api/auth/register', guard, limiter.middleware('register', 15, 15 * 60000), auth.register);
    router.post('/api/auth/login/check', guard, limiter.middleware('login-check', 40, 15 * 60000), auth.check);
    router.post('/api/auth/login', guard, limiter.middleware('login', 40, 15 * 60000), auth.login);
    router.get(['/api/auth/me', '/api/auth/session'], requireAuth(db), auth.me);
    router.post('/api/auth/logout', guard, auth.logout);
  }
  router.get('/forgot-password', recovery.showForgot);
  router.post(['/api/auth/forgot-password', '/forgot-password'], guard, limiter.middleware('send-email', 10, 15 * 60000), recovery.sendEmail);
  router.get('/api/auth/reset-password/validate', limiter.middleware('reset-validate', 60, 15 * 60000), recovery.validate);
  router.get('/reset-password', limiter.middleware('reset-validate', 60, 15 * 60000), recovery.showReset);
  router.post(['/api/auth/reset-password', '/reset-password'], guard, limiter.middleware('reset', 60, 15 * 60000), recovery.savePassword);
  return router;
}
