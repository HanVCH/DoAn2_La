import { test } from 'node:test';
import assert from 'node:assert/strict';
import argon2 from 'argon2';
import { setup, register, account } from '../support/fixture.mjs';
import { normalizePhone, normalizeEmail, validEmail, passwordError } from '../../shared/auth-policy.mjs';
import { hashPassword, verifyPassword } from '../../BackEnd/services/passwords.js';
import { hashToken } from '../../BackEnd/services/tokens.js';
import { initializeSchema } from '../../BackEnd/db/schema-tools.js';

const login = (client, identifier = account.email, password = account.password, type = 'email', extra = {}) =>
  client.post('/api/auth/login', { type, identifier, password, ...extra });

test('normalizes identifiers and enforces ASCII email / 72 UTF-8 bytes without changing passwords', () => {
  for (const phone of ['0901234567', '84901234567', '+84901234567', '(090) 123-45.67']) assert.equal(normalizePhone(phone), '+84901234567');
  assert.equal(normalizePhone('+1 (202) 555-0123'), '+12025550123');
  assert.equal(normalizePhone(901234567), '');
  assert.equal(normalizeEmail(' A.B+tag@GMAIL.COM '), 'a.b+tag@gmail.com');
  for (const email of ['é@gmail.com', 'a..b@gmail.com', 'a@-gmail.com', 'a@b', 'a'.repeat(255)+'@x.com']) assert.equal(validEmail(email), false);
  assert.equal(passwordError('abcdefgh'), '');
  assert.equal(passwordError('12345678'), '');
  assert.equal(passwordError('a'.repeat(72)), '');
  assert.ok(passwordError('a'.repeat(73))); assert.ok(passwordError('ộ'.repeat(25)));
});

test('registration calls SQL, returns safe string IDs and redirects without a session', async t => {
  const f = await setup(t);
  const response = await register(f.client, { ...account, email: ' A.B+Tag@GMAIL.COM ', phone: '84 912-345-678' });
  assert.equal(response.status, 201);
  const data = await response.json();
  assert.equal(data.success, true); assert.equal(data.code, 'REGISTER_SUCCESS'); assert.equal(data.redirectTo, '/login');
  assert.equal(typeof data.data.user.id, 'string'); assert.equal(data.data.user.email, 'a.b+tag@gmail.com');
  assert.equal(data.data.user.phone, '+84912345678'); assert.ok(!JSON.stringify(data).includes('hash'));
  assert.equal(f.client.cookies.has('la_session'), false);
  const [row] = await f.db.execute('SELECT password_hash, email_verified_at FROM users');
  assert.match(row.password_hash, /^\$2[ab]\$12\$/); assert.equal(row.email_verified_at, null);
  assert.equal(await verifyPassword(account.password, row.password_hash), true);
});

test('registration validates confirmation and distinguishes concurrent UNIQUE violations', async t => {
  const f = await setup(t);
  assert.equal((await register(f.client, { ...account, confirmPassword: 'wrong' })).status, 400);
  assert.equal((await register(f.client, { ...account, phone: 912345678 })).status, 400);
  const responses = await Promise.all([register(f.client), register(f.client)]);
  assert.deepEqual(responses.map(r => r.status).sort(), [201,409]);
  const duplicate = await responses.find(r => r.status === 409).json();
  assert.equal(duplicate.code, 'EMAIL_ALREADY_USED');
  const phone = await register(f.client, { ...account, email: 'other@example.com' });
  assert.equal(phone.status, 409); assert.equal((await phone.json()).code, 'PHONE_ALREADY_USED');
});

test('login check handles unknown email/phone, password, disabled and OAuth states without sessions', async t => {
  const f = await setup(t); await register(f.client);
  for (const [type, identifier, code] of [['email','missing@gmail.com','EMAIL_NOT_REGISTERED'],['phone','0901234567','PHONE_NOT_REGISTERED'],['email',account.email,'PASSWORD_REQUIRED'],['phone','84 912 345 678','PASSWORD_REQUIRED']]) {
    const r = await f.client.post('/api/auth/login/check', { type, identifier });
    assert.equal(r.status, 200);
    const data = await r.json(); assert.equal(data.success, true); assert.equal(data.code, code);
    assert.equal(data.data.allow_password, code === 'PASSWORD_REQUIRED');
  }
  assert.equal((await f.client.post('/api/auth/login/check', {type:'other',identifier:account.email})).status, 400);
  assert.equal((await f.client.post('/api/auth/login/check', {type:'email',identifier:'sai'})).status, 400);
  await f.db.execute("UPDATE users SET status = 'disabled'");
  assert.equal((await f.client.post('/api/auth/login/check', {type:'email',identifier:account.email})).status, 403);
  assert.equal((await login(f.client)).status, 403);
  await f.db.execute("UPDATE users SET status = 'active', password_hash = NULL");
  const oauth = await f.client.post('/api/auth/login/check', {type:'email',identifier:account.email});
  assert.equal((await oauth.json()).code, 'PASSWORD_NOT_SET');
  assert.equal((await login(f.client)).status, 401);
  assert.equal(f.client.cookies.has('la_session'), false);
});

test('login rechecks account, ignores forged identity/version and uses hashed HttpOnly sessions', async t => {
  const f = await setup(t); await register(f.client);
  const wrong = await login(f.client, account.email, 'wrong');
  assert.equal(wrong.status, 401); assert.equal((await wrong.json()).code, 'INVALID_PASSWORD');
  const response = await login(f.client, '0912-345-678', account.password, 'phone', { user_id: '999', auth_version: 900, allow_password: true });
  assert.equal(response.status, 200);
  const body = await response.json(); assert.equal(body.data.user.email, account.email);
  assert.ok(!JSON.stringify(body).includes(f.client.cookies.get('la_session')));
  const cookie = response.headers.getSetCookie().find(c => c.startsWith('la_session='));
  assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Lax/); assert.match(cookie, /Path=\//);
  const [session] = await f.db.execute('SELECT * FROM auth_sessions');
  assert.equal(session.token_hash, hashToken(f.client.cookies.get('la_session')));
  assert.equal((await f.client.get('/api/auth/me')).status, 200);
  await f.db.execute('UPDATE auth_sessions SET expires_at = DATE_SUB(UTC_TIMESTAMP(6), INTERVAL 1 SECOND), created_at = DATE_SUB(UTC_TIMESTAMP(6), INTERVAL 1 DAY)');
  assert.equal((await f.client.get('/api/auth/me')).status, 401);
});

test('disabled/revoked/version-mismatched sessions fail and logout is idempotent', async t => {
  const f = await setup(t); await register(f.client); await login(f.client);
  await f.db.execute('UPDATE users SET auth_version = auth_version + 1');
  assert.equal((await f.client.get('/api/auth/me')).status, 401);
  await login(f.client); await f.db.execute("UPDATE users SET status = 'disabled'");
  assert.equal((await f.client.get('/api/auth/me')).status, 401);
  await f.db.execute("UPDATE users SET status = 'active'");
  await login(f.client);
  const currentHash = hashToken(f.client.cookies.get('la_session'));
  for (let n=0;n<2;n++) assert.equal((await f.client.post('/api/auth/logout', {})).status, 200);
  assert.equal((await f.client.get('/api/auth/me')).status, 401);
  assert.ok((await f.db.execute('SELECT revoked_at FROM auth_sessions WHERE token_hash = ?', [currentHash]))[0].revoked_at);
});

test('Argon2id accounts work; unsupported hashes fail closed; password spaces are preserved', async t => {
  const f = await setup(t); await register(f.client);
  const encoded = await argon2.hash(account.password);
  await f.db.execute('UPDATE users SET password_hash = ?', [encoded]);
  assert.equal((await login(f.client)).status, 200);
  await f.db.execute("UPDATE users SET password_hash = 'unsupported'");
  assert.equal((await login(f.client)).status, 401);
  const password = '  Abcd123  ';
  assert.equal(await verifyPassword(password, await hashPassword(password)), true);
  assert.equal(await verifyPassword(password.trim(), await hashPassword(password)), false);
});

test('UTC SQL sessions, exact BIGINT IDs and repeatable migration preserve existing accounts', async t => {
  const f = await setup(t);
  const bigId = '9007199254740993';
  const encoded = await hashPassword(account.password);
  await f.db.execute('INSERT INTO users (id,email,phone,password_hash) VALUES (?,?,?,?)', [bigId,account.email,'+84912345678',encoded]);
  for (let n=0;n<15;n++) {
    const [row] = await f.db.execute('SELECT @@session.time_zone AS zone');
    assert.equal(row.zone, '+00:00');
  }
  assert.equal((await (await login(f.client)).json()).data.user.id, bigId);
  const oldVersion = (await f.db.execute('SELECT auth_version FROM users'))[0].auth_version;
  await initializeSchema(f.config.database);
  const [row] = await f.db.execute('SELECT id, password_hash, auth_version FROM users');
  assert.equal(row.id, bigId); assert.equal(row.password_hash, encoded); assert.equal(row.auth_version, oldVersion);
  assert.equal((await f.db.execute('SELECT COUNT(*) AS n FROM users'))[0].n, '1');
});

test('stale login snapshot cannot issue a session after password reset', async t => {
  const f = await setup(t); await register(f.client);
  const [user] = await f.db.call('la_auth_get_login_user_by_identifier', ['email',account.email]);
  await f.client.post('/api/auth/forgot-password', {identifier:account.email});
  const token = f.messages[0].text.match(/token=([a-f0-9]{64})/)[1];
  await f.client.post('/api/auth/reset-password', {token,newPassword:'NewPass123',confirmPassword:'NewPass123'});
  await assert.rejects(f.db.call('la_auth_create_session', [user.id,user.auth_version,hashToken('a'.repeat(64)),10080]), e => e.sqlMessage === 'AUTH_LOGIN_AGAIN');
  assert.equal((await f.db.execute('SELECT COUNT(*) AS n FROM auth_sessions'))[0].n,'0');
});

test('migration refuses incompatible existing tables and keeps password data intact', async t => {
  const f = await setup(t); await register(f.client);
  const [before] = await f.db.execute('SELECT password_hash FROM users');
  await f.db.execute('ALTER TABLE users MODIFY display_name VARCHAR(120) NULL');
  await assert.rejects(initializeSchema(f.config.database), /users.display_name/);
  assert.equal((await f.db.execute('SELECT password_hash FROM users'))[0].password_hash, before.password_hash);
});
