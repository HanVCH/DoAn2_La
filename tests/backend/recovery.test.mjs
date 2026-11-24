import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, createClient, register, account, lastResetToken } from '../support/fixture.mjs';
import { createRecoveryService } from '../../BackEnd/services/recovery.js';
import { hashToken, createToken } from '../../BackEnd/services/tokens.js';

const requestReset = (f, identifier = account.email) => f.client.post('/api/auth/forgot-password', { identifier });
const body = token => ({ token, newPassword: 'LaMoi2026', confirmPassword: 'LaMoi2026' });

test('unknown accounts redirect and disabled/OAuth accounts issue no tokens', async t => {
  const f = await setup(t);
  const unknown = await requestReset(f);
  assert.equal(unknown.status,404); const data=await unknown.json();
  assert.equal(data.code,'ACCOUNT_NOT_FOUND'); assert.equal(data.redirectTo,'/login');
  await register(f.client);
  await f.db.execute("UPDATE users SET status='disabled'");
  assert.equal((await requestReset(f)).status,403);
  await f.db.execute("UPDATE users SET status='active',password_hash=NULL");
  const oauth=await requestReset(f); assert.equal(oauth.status,409); assert.equal((await oauth.json()).code,'PASSWORD_NOT_SET');
  assert.equal((await f.db.execute('SELECT COUNT(*) AS n FROM password_reset_tokens'))[0].n,'0');
});

test('SMTP accepts real HTML/text email addressed only to the SQL-returned account', async t => {
  const f=await setup(t); await register(f.client);
  const response=await f.client.post('/api/auth/forgot-password',{identifier:'+84 912.345.678',email:'attacker@gmail.com',user_id:'999'},{Host:'evil.test'});
  assert.equal(response.status,200); const data=await response.json();
  assert.equal(data.data.sent,true); assert.equal(data.data.maskedEmail,'h***@gmail.com');
  const mail=f.messages[0]; assert.deepEqual(mail.to,[account.email]); assert.match(mail.text,/15 phút/); assert.match(mail.html,/Đặt lại mật khẩu/);
  assert.ok(mail.text.includes(f.base)); assert.ok(!mail.text.includes('evil.test'));
  const raw=lastResetToken(f); const [record]=await f.db.execute('SELECT * FROM password_reset_tokens');
  assert.equal(record.token_hash,hashToken(raw)); assert.equal(record.used_at,null);
  assert.ok(!JSON.stringify(data).includes(raw)); assert.ok(!JSON.stringify(data).includes('token_hash'));
});

test('SMTP errors revoke exactly the new token; newer issuance revokes older token', async t => {
  const f=await setup(t); await register(f.client); await requestReset(f);
  const old=lastResetToken(f);
  f.smtpState.reject=true;
  const failed=await requestReset(f); assert.equal(failed.status,502); assert.equal((await failed.json()).code,'MAIL_SEND_FAILED');
  const rows=await f.db.execute('SELECT revoked_at FROM password_reset_tokens');
  assert.equal(rows.length,2); assert.ok(rows.every(row=>row.revoked_at));
  assert.equal((await f.client.get('/api/auth/reset-password/validate?token='+old)).status,400);
  f.smtpState.reject=false;
  assert.equal((await requestReset(f)).status,200);
});

test('SMTP configuration failure leaves register/login usable and does not issue reset tokens', async t => {
  const f=await setup(t); await register(f.client);
  const service=createRecoveryService({...f,mailer:{ready:false}});
  await assert.rejects(service.requestReset(account.email),e=>e.status===503&&e.code==='MAIL_NOT_CONFIGURED');
  assert.equal((await f.db.execute('SELECT COUNT(*) AS n FROM password_reset_tokens'))[0].n,'0');
  assert.equal((await f.client.post('/api/auth/login',{type:'email',identifier:account.email,password:account.password})).status,200);
});

test('token validation is read-only and rejects malformed, expired, used, revoked or stale tokens', async t => {
  const f=await setup(t); await register(f.client); await requestReset(f);
  const raw=lastResetToken(f), url='/api/auth/reset-password/validate?token='+raw;
  for(let n=0;n<2;n++) assert.equal((await f.client.get(url)).status,200);
  assert.equal((await f.db.execute('SELECT used_at FROM password_reset_tokens'))[0].used_at,null);
  for(const invalid of ['bad',createToken()]) assert.equal((await f.client.get('/api/auth/reset-password/validate?token='+invalid)).status,400);
  await f.db.execute('UPDATE password_reset_tokens SET expires_at=DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 1 SECOND),created_at=DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 1 DAY)');
  assert.equal((await f.client.get(url)).status,400);
  assert.equal((await f.client.post('/api/auth/reset-password',body(raw))).status,400);
  await f.db.execute('UPDATE password_reset_tokens SET expires_at=DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 15 MINUTE),revoked_at=UTC_TIMESTAMP(6)');
  assert.equal((await f.client.get(url)).status,400);
  await f.db.execute('UPDATE password_reset_tokens SET revoked_at=NULL,used_at=UTC_TIMESTAMP(6)');
  assert.equal((await f.client.get(url)).status,400);
  await f.db.execute('UPDATE password_reset_tokens SET used_at=NULL,auth_version_at_issue=auth_version_at_issue+1');
  assert.equal((await f.client.get(url)).status,400);
});

test('reset rejects mismatched/oversize passwords without consuming a token', async t => {
  const f=await setup(t); await register(f.client); await requestReset(f); const raw=lastResetToken(f);
  for(const password of ['short','a'.repeat(73),'ộ'.repeat(25)]) {
    const response=await f.client.post('/api/auth/reset-password',{token:raw,newPassword:password,confirmPassword:password}); assert.equal(response.status,400);
  }
  assert.equal((await f.client.post('/api/auth/reset-password',{...body(raw),confirmPassword:'other'})).status,400);
  assert.equal((await f.db.execute('SELECT used_at FROM password_reset_tokens'))[0].used_at,null);
});

test('only one concurrent reset succeeds; reuse, old passwords and old cookies fail immediately', async t => {
  const f=await setup(t); await register(f.client);
  const old=createClient(f.base); await old.init();
  const login=(client,password)=>client.post('/api/auth/login',{type:'email',identifier:account.email,password});
  assert.equal((await login(old,account.password)).status,200);
  await requestReset(f); const first=lastResetToken(f);
  await requestReset(f,'84912345678'); const raw=lastResetToken(f);
  assert.equal((await f.client.get('/api/auth/reset-password/validate?token='+first)).status,400);
  const responses=await Promise.all([1,2].map(()=>f.client.post('/api/auth/reset-password',{...body(raw),user_id:'999',email:'attacker@gmail.com'})));
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,400]);
  assert.equal((await responses.find(r=>r.status===200).json()).redirectTo,'/login');
  assert.equal((await f.client.post('/api/auth/reset-password',body(raw))).status,400);
  assert.equal((await old.get('/api/auth/me')).status,401);
  assert.equal((await login(f.client,account.password)).status,401);
  assert.equal((await login(f.client,'LaMoi2026')).status,200);
  assert.equal((await f.db.execute('SELECT auth_version FROM users'))[0].auth_version,1);
});

test('SQL transaction failure rolls back password and token consumption together', async t => {
  const f=await setup(t); await register(f.client); await requestReset(f);
  const raw=lastResetToken(f); const [before]=await f.db.execute('SELECT password_hash FROM users');
  await f.db.execute("CREATE TRIGGER fail_token_update BEFORE UPDATE ON password_reset_tokens FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='TEST_ROLLBACK'");
  const response=await f.client.post('/api/auth/reset-password',body(raw)); assert.equal(response.status,503);
  assert.equal((await f.db.execute('SELECT password_hash FROM users'))[0].password_hash,before.password_hash);
  assert.equal((await f.db.execute('SELECT used_at FROM password_reset_tokens'))[0].used_at,null);
});
