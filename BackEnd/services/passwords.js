import bcrypt from 'bcryptjs';
import argon2 from 'argon2';

export const hashPassword = password => bcrypt.hash(password, 12);
export async function verifyPassword(password, encoded) {
  if (typeof password !== 'string' || !password || Buffer.byteLength(password, 'utf8') > 72 || typeof encoded !== 'string') return false;
  try {
    if (/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(encoded)) return await bcrypt.compare(password, encoded);
    if (encoded.startsWith('$argon2id$')) return await argon2.verify(encoded, password);
  } catch { /* Malformed/unsupported hashes fail closed. */ }
  return false;
}
