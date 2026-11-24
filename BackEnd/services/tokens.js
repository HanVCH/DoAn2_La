import { randomBytes, createHash } from 'node:crypto';
export const createToken = () => randomBytes(32).toString('hex');
export const hashToken = value => createHash('sha256').update(value).digest('hex');
export const validTokenFormat = value => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
export const invalidLinkMessage = 'Liên kết không hợp lệ, đã được sử dụng hoặc đã hết hạn.';
export async function findResetToken(db, raw) {
  if (!validTokenFormat(raw)) return undefined;
  const rows = await db.execute(`SELECT t.id, t.user_id FROM password_reset_tokens t
    JOIN users u ON u.id = t.user_id WHERE t.token_hash = ?
    AND t.used_at IS NULL AND t.revoked_at IS NULL AND t.expires_at > UTC_TIMESTAMP(6)
    AND u.status = 'active' AND t.auth_version_at_issue = u.auth_version LIMIT 1`, [hashToken(raw)]);
  return rows[0];
}
