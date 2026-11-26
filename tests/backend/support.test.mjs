import test from 'node:test';
import assert from 'node:assert/strict';
import { askSupport } from '../../BackEnd/services/support-chat.js';
import { account, createClient, register, startFixture } from '../support/fixture.mjs';

const endpoint = '/api/support/chat';
const question = 'Cách tạo ngân sách?';

test('support API requires completed onboarding, validates and limits requests, and sends only static help',async t=>{
  const calls = [];
  const fixture = await startFixture({supportFetch:async (url,options)=>{
    calls.push({url,body:JSON.parse(options.body)});
    return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'Mở Ngân sách và chọn Tạo ngân sách.'}]}]});
  }});
  t.after(()=>fixture.close());
  const client = createClient(fixture.base);
  await client.init();
  assert.equal((await client.post(endpoint,{message:question})).status,401);
  assert.equal((await register(client)).status,201);
  const login = ()=>client.post('/api/auth/login',{type:'email',identifier:account.email,password:account.password});
  assert.equal((await login()).status,200);
  assert.equal((await client.post(endpoint,{message:question})).status,403);
  const [user] = await fixture.db.execute('SELECT id FROM users WHERE email=?',[account.email]);
  await fixture.db.call('la_onboarding_save_profile',[user.id,'Nguyễn Văn An','1998-06-12','Đà Nẵng','18000000.00','save_money',null]);
  await fixture.db.execute('UPDATE users SET email_verified_at=UTC_TIMESTAMP(6) WHERE id=?',[user.id]);
  await fixture.db.call('la_onboarding_complete',[user.id]);
  assert.equal((await client.post(endpoint,{message:question},{'X-CSRF-Token':''})).status,403);
  assert.equal((await client.post(endpoint,{message:''})).status,400);
  assert.equal((await client.post(endpoint,{message:'x'.repeat(501)})).status,400);
  const missing = await client.post(endpoint,{message:question});
  assert.equal(missing.status,503);
  assert.equal((await missing.json()).code,'SUPPORT_NOT_CONFIGURED');
  fixture.config.supportAi.apiKey = 'test-key';
  const secret = 'private@example.test OTP 192348 ghi chú cá nhân 3.000.000đ';
  const answer = await client.post(endpoint,{message:`Cách tạo ngân sách? ${secret}`,transactions:[secret],user:secret});
  assert.deepEqual((await answer.json()).data,{answer:'Mở Ngân sách và chọn Tạo ngân sách.'});
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,'https://api.openai.com/v1/responses');
  assert.equal(calls[0].body.store,false);
  assert.match(calls[0].body.input,/^Cách tạo ngân sách\?/);
  assert.doesNotMatch(JSON.stringify(calls[0]),/private@example|192348|3\.000\.000/);
  const clarification = await client.post(endpoint,{message:'Chào bạn'});
  assert.match((await clarification.json()).data.answer,/trang nào/);
  assert.equal(calls.length,1);
  for (let attempt=0;attempt<3;attempt++) assert.equal((await client.post(endpoint,{message:question})).status,200);
  const limited = await client.post(endpoint,{message:question});
  assert.equal(limited.status,429);
  assert.ok(Number(limited.headers.get('retry-after'))>0);
});

test('AI adapter maps rejected and incomplete replies and timeouts to friendly errors',async()=>{
  const config = {apiKey:'test-key',model:'test-model'};
  await assert.rejects(askSupport(config,question,async()=>new Response('',{status:403})),{status:502,code:'SUPPORT_UNAVAILABLE'});
  await assert.rejects(askSupport(config,question,async()=>Response.json({status:'incomplete'})),{status:502,code:'SUPPORT_UNAVAILABLE'});
  await assert.rejects(askSupport(config,question,async()=>{throw new DOMException('test','TimeoutError');}),{status:504,code:'SUPPORT_TIMEOUT'});
});
