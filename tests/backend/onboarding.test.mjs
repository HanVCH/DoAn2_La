import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup,startFixture,createClient,register,account } from '../support/fixture.mjs';
import { profileInput,birthDateError,ageFromBirthDate } from '../../shared/profile-policy.mjs';
import { createOnboardingService,otpHash } from '../../BackEnd/services/onboarding.js';
import { initializeSchema } from '../../BackEnd/db/schema-tools.js';
import { createToken } from '../../BackEnd/services/tokens.js';

const profile = {fullName:'Nguyễn Văn An',birthDate:'2000-02-29',hometown:'Thành phố Hồ Chí Minh',monthlyIncome:'0',usagePurpose:'track_expenses',usagePurposeNote:''};
const login = client=>client.post('/api/auth/login',{type:'email',identifier:account.email,password:account.password});
const otpFromMail = f => f.messages.map(m => m.text.match(/token=([a-f0-9]{64})\.([a-f0-9]{64})/)).filter(Boolean).at(-1)[2];
async function authenticated(t,options) {
  const f = options ? await startFixture(options) : await startFixture();t.after(()=>f.close());
  f.client=createClient(f.base);await f.client.init();assert.equal((await register(f.client)).status,201);await login(f.client);return f;
}
async function issue(f,channel='email') {
  const response=await f.client.post('/api/onboarding/verification/send',{channel});
  assert.equal(response.status,200);return (await response.json()).data;
}
const confirm = (f,challengeId,otp=otpFromMail(f))=>f.client.post('/onboarding/verify-email',{token:challengeId+'.'+otp});
const confirmSms = (f,challengeId,otp)=>f.client.post('/api/onboarding/verification/confirm',{challengeId,otp});
async function cooldownPassed(f) {await f.db.execute('UPDATE user_contact_verifications SET created_at=DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 61 SECOND)');}

test('validates real UTC birth dates, age boundaries, required Unicode text and exact decimal income',()=>{
  const today=new Date('2026-11-09T00:00:00Z');
  for(const date of ['2000-02-29','1906-11-09'])assert.equal(birthDateError(date,today),'');
  for(const date of ['2001-02-29','2026-11-10','1906-11-08','2026-13-01','2026-04-31',''])assert.ok(birthDateError(date,today));
  assert.equal(ageFromBirthDate('2000-11-10',today),25);assert.equal(ageFromBirthDate('2000-11-09',today),26);
  for(const income of ['',null,-1,'-1','1e3','0.001','10000000000000','00','1,000'])assert.ok(profileInput({...profile,monthlyIncome:income},today).errors.monthlyIncome);
  for(const income of ['0','0.00','9999999999999.99'])assert.equal(profileInput({...profile,monthlyIncome:income},today).value.monthlyIncome,income);
  for(const field of ['fullName','birthDate','hometown'])assert.ok(profileInput({...profile,[field]:''},today).errors[field]);
  assert.ok(profileInput({...profile,usagePurpose:'other',usagePurposeNote:''},today).errors.usagePurposeNote);
  assert.deepEqual(profileInput({...profile,usagePurpose:'other',usagePurposeNote:'Dành dụm mua nhà'},today).errors,{});
});

test('old/new accounts cannot bypass the page or API gate; logout remains available',async t=>{
  const f=await setup(t);
  assert.equal((await f.client.get('/onboarding')).headers.get('location'),'/login');
  assert.equal((await f.client.get('/')).headers.get('location'),'/login');
  assert.equal((await f.client.get('/api/onboarding')).status,401);
  await register(f.client);const signed=await login(f.client),data=await signed.json();
  assert.equal(data.data.needs_onboarding,true);assert.equal(data.redirectTo,'/onboarding');
  const me=await (await f.client.get('/api/auth/me')).json();assert.equal(me.data.needs_onboarding,true);
  assert.equal((await f.client.get('/')).headers.get('location'),'/onboarding');
  for(const url of ['/api/home','/api/finance','/api/transactions','/api/dashboard','/api/reports']) {
    const denied=await f.client.get(url);assert.equal(denied.status,403);assert.equal((await denied.json()).code,'ONBOARDING_REQUIRED');
  }
  assert.equal((await f.client.post('/api/onboarding/complete',{completed:true,verified:true,user_id:'999'})).status,400);
  assert.equal((await f.client.get('/onboarding')).status,200);
  assert.equal((await f.client.post('/api/auth/logout',{})).status,200);
});

test('profile save is owner-only, precise, reloadable and does not complete onboarding',async t=>{
  const f=await authenticated(t);
  const response=await f.client.put('/api/onboarding/profile',{...profile,monthlyIncome:'9999999999999.99',user_id:'999',email_verified_at:'2026-01-01',onboarding_completed_at:'2026-01-01'});
  assert.equal(response.status,200);const data=(await response.json()).data;
  assert.equal(data.monthly_income,'9999999999999.99');assert.equal(data.birth_date,'2000-02-29');
  assert.equal(data.full_name,profile.fullName);assert.equal(data.profile_complete,true);assert.equal(data.contact_verified,false);assert.equal(data.needs_onboarding,true);assert.equal(data.onboarding_completed_at,null);
  const [row]=await f.db.execute('SELECT display_name,email_verified_at FROM users');assert.equal(row.display_name,profile.fullName);assert.equal(row.email_verified_at,null);
  assert.equal((await f.db.execute('SELECT COUNT(*) AS n FROM user_profiles WHERE user_id=999'))[0].n,'0');
  const reload=(await (await f.client.get('/api/onboarding')).json()).data;assert.equal(reload.monthly_income,data.monthly_income);
  const incomplete=await f.client.post('/api/onboarding/complete',{});assert.equal((await incomplete.json()).code,'ONBOARDING_CONTACT_NOT_VERIFIED');
  const bad=await f.client.put('/api/onboarding/profile',{...profile,monthlyIncome:''});assert.equal(bad.status,400);assert.ok((await bad.json()).data.errors.monthlyIncome);
  assert.equal((await f.client.put('/api/onboarding/profile',profile,{'X-CSRF-Token':''})).status,403);
});

test('email verification link uses HMAC, database destination, public challenge metadata and SQL cooldown',async t=>{
  const f=await authenticated(t);
  const response=await f.client.post('/api/onboarding/verification/send',{channel:'email',destination:'attacker@test.com',user_id:'999'});
  assert.equal(response.status,200);const data=(await response.json()).data,otp=otpFromMail(f);
  assert.deepEqual(f.messages[0].to,[account.email]);assert.match(f.messages[0].text,/5 phút/);assert.match(f.messages[0].html,/Xác thực email/);
  assert.deepEqual(Object.keys(data).sort(),['challengeId','channel','destination','expiresAt','resendAfterSeconds','sendLimit'].sort());assert.equal(data.destination,'h***@gmail.com');
  assert.equal(data.sendLimit.remaining,4);
  assert.ok(!JSON.stringify(data).includes(otp));
  const [row]=await f.db.execute('SELECT * FROM user_contact_verifications');
  assert.equal(row.token_hash,otpHash(f.config.otpPepper,data.challengeId,row.user_id,'email',account.email,otp));assert.equal(row.attempts,0);assert.equal(row.max_attempts,5);
  const next=await f.client.post('/api/onboarding/verification/send',{channel:'email'});assert.equal(next.status,429);assert.ok(Number(next.headers.get('retry-after'))<=60);
  const state=(await (await f.client.get('/api/onboarding')).json()).data;assert.equal(state.pending_verifications[0].challengeId,data.challengeId);
  assert.ok(!JSON.stringify(state).includes(row.token_hash));
});

test('five sends per Vietnam calendar day are shared across email and SMS and safe under concurrent requests',async t=>{
  const f=await authenticated(t,{smsAvailable:true});
  const [[user],[day]]=await Promise.all([
    f.db.execute('SELECT id FROM users WHERE email=?',[account.email]),
    f.db.execute('SELECT DATE_SUB(DATE(UTC_TIMESTAMP()+INTERVAL 7 HOUR),INTERVAL 7 HOUR) AS starts'),
  ]);
  for (let index=0;index<4;index++) {
    await f.db.execute(`INSERT INTO user_contact_verifications
      (user_id,channel,destination,request_key,token_hash,auth_version_at_issue,expires_at,created_at)
      VALUES (?,'email',?,?,?,0,UTC_TIMESTAMP(6),?)`,[user.id,account.email,createToken(),createToken(),day.starts]);
  }
  const send=channel=>f.client.post('/api/onboarding/verification/send',{channel});
  const replies=await Promise.all([send('phone'),send('phone')]);
  assert.deepEqual(replies.map(response=>response.status).sort(),[200,429]);
  const accepted=await replies.find(response=>response.status===200).json();
  const rejected=await replies.find(response=>response.status===429).json();
  assert.equal(rejected.code,'VERIFY_DAILY_LIMIT');
  assert.deepEqual(accepted.data.sendLimit,rejected.data.sendLimit);
  assert.equal(rejected.data.sendLimit.remaining,0);
  assert.match(rejected.data.sendLimit.resetAt,/T17:00:00\.000Z$/);
  assert.equal((await (await send('email')).json()).code,'VERIFY_DAILY_LIMIT');
  assert.equal(f.smsMessages.length,1);

  const cappedState=await (await f.client.get('/api/onboarding')).json();
  assert.deepEqual(cappedState.data.verification_send_limit,rejected.data.sendLimit);

  await f.db.execute('UPDATE user_contact_verifications SET created_at=DATE_SUB(?,INTERVAL 5 MINUTE) WHERE user_id=?',[day.starts,user.id]);
  const state=await (await f.client.get('/api/onboarding')).json();
  assert.equal(state.data.verification_send_limit.remaining,5);
  const next=await send('email');
  assert.equal(next.status,200);
  for (let index=0;index<4;index++) {
    const blocked=await send('email');
    assert.equal((await blocked.json()).code,'VERIFY_RESEND_TOO_SOON');
    assert.ok(Number(blocked.headers.get('retry-after'))<=60);
  }
  assert.equal((await (await f.client.get('/api/onboarding')).json()).data.verification_send_limit.remaining,4);
});

test('incorrect OTP commits attempt counters, permits leading zero, locks at five and cannot be reused',async t=>{
  const confirm = confirmSms;
  const f=await authenticated(t,{smsAvailable:true});const data=await issue(f,'phone');let otp=f.smsMessages.at(-1).otp;
  // Set a synthetic leading-zero OTP in this isolated database to exercise exact formatting.
  const [user]=await f.db.execute('SELECT id FROM users');otp='012345';
  await f.db.execute('UPDATE user_contact_verifications SET token_hash=?',[otpHash(f.config.otpPepper,data.challengeId,user.id,'phone','+84912345678',otp)]);
  const bad=await confirm(f,data.challengeId,'999999');assert.equal(bad.status,400);assert.equal((await bad.json()).data.attemptsRemaining,4);
  assert.equal((await f.db.execute('SELECT attempts FROM user_contact_verifications'))[0].attempts,1);
  assert.equal((await confirm(f,data.challengeId,12345)).status,400);
  assert.equal((await confirm(f,data.challengeId,otp)).status,200);
  assert.equal((await confirm(f,data.challengeId,otp)).status,400);
  await f.db.execute('UPDATE users SET phone_verified_at=NULL');await cooldownPassed(f);const second=await issue(f,'phone');const correct=f.smsMessages.at(-1).otp,wrong=correct==='111111'?'222222':'111111';
  for(let i=0;i<5;i++){const result=await confirm(f,second.challengeId,wrong);assert.equal(result.status,i===4?429:400);}
  assert.notEqual((await confirm(f,second.challengeId,correct)).status,200);
});

test('expired, superseded, foreign-owner, changed-contact and pre-reset OTP are rejected',async t=>{
  const f=await authenticated(t);const first=await issue(f),oldOtp=otpFromMail(f);
  await f.db.execute('UPDATE user_contact_verifications SET expires_at=DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 1 SECOND),created_at=DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 61 SECOND)');
  assert.equal((await confirm(f,first.challengeId,oldOtp)).status,400);
  const second=await issue(f);await cooldownPassed(f);const secondOtp=otpFromMail(f),third=await issue(f),thirdOtp=otpFromMail(f);
  assert.equal((await confirm(f,second.challengeId,secondOtp)).status,400);
  const other=createClient(f.base);await other.init();const otherAccount={...account,email:'other@test.com',phone:'0988888888'};await register(other,otherAccount);
  await other.post('/api/auth/login',{type:'email',identifier:otherAccount.email,password:account.password});
  assert.equal((await other.post('/api/onboarding/verification/confirm',{challengeId:third.challengeId,otp:thirdOtp})).status,400);
  await f.db.execute('UPDATE users SET email=? WHERE email=?',['changed@gmail.com',account.email]);
  assert.equal((await confirm(f,third.challengeId,thirdOtp)).status,400);
  await f.db.execute('UPDATE users SET email=? WHERE email=?',[account.email,'changed@gmail.com']);await cooldownPassed(f);const fourth=await issue(f),fourthOtp=otpFromMail(f);
  await f.client.post('/api/auth/forgot-password',{identifier:account.email});const raw=f.messages.filter(m=>m.subject.includes('Yêu cầu')).at(-1).text.match(/token=([a-f0-9]{64})/)[1];
  await f.client.post('/api/auth/reset-password',{token:raw,newPassword:'NewPass123',confirmPassword:'NewPass123'});
  await f.client.post('/api/auth/login',{type:'email',identifier:account.email,password:'NewPass123'});
  assert.equal((await confirm(f,fourth.challengeId,fourthOtp)).status,400);
});

test('concurrent verify uses OTP once; concurrent complete preserves first timestamp and next login skips OTP',async t=>{
  const f=await authenticated(t);await f.client.put('/api/onboarding/profile',profile);const data=await issue(f),otp=otpFromMail(f);
  const verified=await Promise.all([confirm(f,data.challengeId,otp),confirm(f,data.challengeId,otp)]);assert.deepEqual(verified.map(r=>r.status).sort(),[200,400]);
  const before=(await (await f.client.get('/api/onboarding')).json()).data;assert.equal(before.onboarding_completed_at,null);assert.equal(before.contact_verified,true);
  const completed=await Promise.all([1,2].map(()=>f.client.post('/api/onboarding/complete',{completed:false,user_id:'999'})));assert.ok(completed.every(r=>r.status===200));
  const payloads=await Promise.all(completed.map(r=>r.json()));assert.equal(payloads[0].data.onboarding_completed_at,payloads[1].data.onboarding_completed_at);assert.equal(payloads[0].redirectTo,'/dashboard');
  assert.equal((await f.client.get('/')).headers.get('location'),'/dashboard');assert.equal((await f.client.get('/dashboard')).status,200);assert.equal((await f.client.get('/api/home')).status,200);assert.equal((await f.client.get('/onboarding')).headers.get('location'),'/dashboard');
  const saved=(await f.db.execute('SELECT password_hash,onboarding_completed_at,email_verified_at FROM users'))[0];
  await initializeSchema(f.config.database);
  const preserved=(await f.db.execute('SELECT password_hash,onboarding_completed_at,email_verified_at FROM users'))[0];assert.deepEqual(preserved,saved);
  await f.client.post('/api/auth/logout',{});const relog=(await (await login(f.client)).json());assert.equal(relog.data.needs_onboarding,false);assert.equal(relog.redirectTo,'/dashboard');
  assert.equal(f.messages.filter(m=>m.text.includes('/onboarding/verify-email?')).length,1);
});

test('contact trigger clears only changed verification; completion persists while another verified channel remains',async t=>{
  const f=await authenticated(t,{smsAvailable:true});await f.client.put('/api/onboarding/profile',profile);
  const email=await issue(f);await confirm(f,email.challengeId);const phone=await issue(f,'phone');
  assert.equal((await confirmSms(f,phone.challengeId,f.smsMessages[0].otp)).status,200);await f.client.post('/api/onboarding/complete',{});
  const completed=(await f.db.execute('SELECT onboarding_completed_at FROM users'))[0].onboarding_completed_at;
  await f.db.execute('UPDATE users SET email=?',[ 'changed@gmail.com' ]);
  let state=(await (await f.client.get('/api/onboarding')).json()).data;assert.equal(state.email_verified_at,null);assert.ok(state.phone_verified_at);assert.equal(state.needs_onboarding,false);assert.equal(new Date(state.onboarding_completed_at).getTime(),completed.getTime());
  await f.db.execute('UPDATE users SET phone=?',['+84999999999']);state=(await (await f.client.get('/api/onboarding')).json()).data;
  assert.equal(state.phone_verified_at,null);assert.equal(state.onboarding_completed_at,null);assert.equal(state.needs_onboarding,true);assert.equal((await f.client.get('/api/home')).status,403);
});

test('missing SMTP/SMS/pepper issues no challenge; failed transport revokes exactly its issuance',async t=>{
  const f=await authenticated(t);
  const unavailable=await f.client.post('/api/onboarding/verification/send',{channel:'phone'});assert.equal(unavailable.status,503);assert.equal((await unavailable.json()).code,'SMS_NOT_CONFIGURED');
  const noPepper=createOnboardingService({...f,config:{...f.config,otpPepper:''}});await assert.rejects(noPepper.send('1','email'),e=>e.code==='OTP_NOT_CONFIGURED');
  const noMail=createOnboardingService({...f,mailer:{ready:false}});await assert.rejects(noMail.send('1','email'),e=>e.code==='MAIL_NOT_CONFIGURED');
  assert.equal((await f.db.execute('SELECT COUNT(*) AS n FROM user_contact_verifications'))[0].n,'0');
  f.smtpState.reject=true;assert.equal((await f.client.post('/api/onboarding/verification/send',{channel:'email'})).status,502);
  const [row]=await f.db.execute('SELECT revoked_at FROM user_contact_verifications');assert.ok(row.revoked_at);
});

test('SMS mock supports verification and transport failure revokes its own challenge',async t=>{
  const f=await authenticated(t,{smsAvailable:true});f.smsState.reject=true;
  assert.equal((await f.client.post('/api/onboarding/verification/send',{channel:'phone'})).status,502);
  assert.ok((await f.db.execute('SELECT revoked_at FROM user_contact_verifications'))[0].revoked_at);
  await cooldownPassed(f);f.smsState.reject=false;const data=await issue(f,'phone');assert.equal(f.smsMessages[0].destination,'+84912345678');
  const result=(await (await confirmSms(f,data.challengeId,f.smsMessages[0].otp)).json()).data;assert.ok(result.phone_verified_at);assert.equal(result.email_verified_at,null);assert.equal(result.needs_onboarding,true);
});
