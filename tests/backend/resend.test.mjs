import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createResend} from '../../BackEnd/services/resend.js';
import {readConfig} from '../../BackEnd/config.js';
import {startFixture,createClient,register,account} from '../support/fixture.mjs';

test('Resend requires server config, sends a verification link and rejects error/malformed/timeout responses',async()=>{
  assert.equal(createResend(readConfig({})).ready,false);
  const config=readConfig({RESEND_API_KEY:'re_test_only',RESEND_FROM:'LÁ <onboarding@resend.dev>'});
  const adapter=createResend(config,async(url,options)=>{
    assert.equal(url,'https://api.resend.com/emails');
    assert.equal(options.headers.Authorization,'Bearer re_test_only');
    const body=JSON.parse(options.body);assert.deepEqual(body.to,['owner@test.com']);assert.match(body.text,/verify-email/);assert.match(body.html,/verify-email/);
    return new Response(JSON.stringify({id:'accepted-id'}));
  });
  await adapter.sendEmail('owner@test.com',{subject:'Test',text:'verify-email',html:'<a>verify-email</a>'});
  await assert.rejects(createResend(config,async()=>Response.json({message:'You can only send testing emails to your own email address'}, {status:403})).sendEmail('other@test.com',{subject:'Test',text:'verify-email'}),/RESEND_TEST_RECIPIENT/);
  await assert.rejects(createResend(config,async()=>Response.json({name:'invalid_api_key'}, {status:403})).sendEmail('owner@test.com',{}),/RESEND_AUTH_FAILED/);
  await assert.rejects(createResend(config,async()=>{
    throw new TypeError('fetch failed',{cause:{code:'UNABLE_TO_VERIFY_LEAF_SIGNATURE'}});
  }).sendEmail('owner@test.com',{}),/RESEND_TLS_FAILED/);
  for(const response of [()=>new Response('{}'),()=>new Response('{bad'),()=>new Response(JSON.stringify({id:'x',error:{}})),()=>new Response('{}',{status:403}),()=>{throw new Error('secret provider details');}]) {
    await assert.rejects(createResend(config,async()=>response()).sendEmail('owner@test.com',{subject:'Test',text:'verify-email',html:'<a>verify-email</a>'}),error=>error.message==='RESEND_SEND_FAILED');
  }
});

async function fixture(t){
  const f=await startFixture({resendAvailable:true});t.after(()=>f.close());f.client=createClient(f.base);await f.client.init();await register(f.client);
  await f.client.post('/api/auth/login',{type:'email',identifier:account.email,password:account.password});return f;
}
test('Resend OTP route uses session account, rejects wrong/expired codes, confirms and completes onboarding',async t=>{
  const f=await fixture(t);
  const send=await f.client.post('/api/onboarding/verification/send',{channel:'email',email:'attacker@test.com',user_id:'999'});
  assert.equal(send.status,200);const challenge=(await send.json()).data;
  assert.equal(f.resendState.calls,1);assert.deepEqual(f.messages[0].to,[account.email]);
  const link = new URL(f.messages[0].text.match(/https?:\/\/\S+/)[0]);
  const token = link.searchParams.get('token');
  const fresh = createClient(f.base);
  await fresh.init();
  assert.equal((await fresh.get(link.pathname+link.search)).status,200);
  assert.equal((await f.db.execute('SELECT email_verified_at FROM users'))[0].email_verified_at,null);
  const confirm=value=>fresh.post('/onboarding/verify-email',{token:value});
  assert.equal((await confirm(challenge.challengeId+'.'+'0'.repeat(64))).status,400);
  await f.db.execute('UPDATE user_contact_verifications SET created_at=DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 6 MINUTE),expires_at=DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 1 SECOND)');
  assert.equal((await confirm(token)).status,400);
  await f.db.execute('UPDATE user_contact_verifications SET expires_at=DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 5 MINUTE)');
  assert.equal((await confirm(token)).status,200);
  assert.equal((await confirm(token)).status,400);
  assert.ok((await f.db.execute('SELECT email_verified_at FROM users'))[0].email_verified_at);
  await f.client.put('/api/onboarding/profile',{fullName:'Nguyễn Văn An',birthDate:'2000-02-29',hometown:'Hồ Chí Minh',monthlyIncome:'0',usagePurpose:'track_expenses',usagePurposeNote:''});
  const completed=await f.client.post('/api/onboarding/complete',{});assert.equal(completed.status,200);assert.equal((await completed.json()).redirectTo,'/dashboard');
});
test('Resend rejection revokes only the issued challenge and reports no false success',async t=>{
  const f=await fixture(t);f.resendState.reject=true;
  const response=await f.client.post('/api/onboarding/verification/send',{channel:'email'});
  assert.equal(response.status,502);assert.equal((await response.json()).code,'MAIL_SEND_FAILED');
  const [row]=await f.db.execute('SELECT revoked_at FROM user_contact_verifications');assert.ok(row.revoked_at);assert.equal(f.messages.length,0);
});
