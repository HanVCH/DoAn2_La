import { readCookie } from './security.js';
import { hashToken, validTokenFormat } from '../services/tokens.js';
import { ApiError } from './errors.js';

export const sessionCookieOptions = config => ({ httpOnly: true, secure: config.cookieSecure, sameSite: 'lax', path: '/' });
export function requireAuth(db, { page = false } = {}) {
  return async (request, response, next) => {
    const token = readCookie(request, 'la_session');
    if (!validTokenFormat(token)) {
      if (page) return response.redirect('/login');
      throw new ApiError(401, 'UNAUTHENTICATED', 'Vui lòng đăng nhập lại.');
    }
    const rows = await db.execute(`SELECT u.id, u.email, u.phone, u.display_name, s.id AS session_id
      FROM auth_sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > UTC_TIMESTAMP(6)
      AND s.auth_version = u.auth_version AND u.status = 'active' LIMIT 1`, [hashToken(token)]);
    if (!rows[0]) {
      if (page) return response.redirect('/login');
      throw new ApiError(401, 'UNAUTHENTICATED', 'Vui lòng đăng nhập lại.');
    }
    request.authUser = rows[0];
    await db.execute('UPDATE auth_sessions SET last_used_at = UTC_TIMESTAMP(6) WHERE id = ?', [String(rows[0].session_id)]);
    next();
  };
}
