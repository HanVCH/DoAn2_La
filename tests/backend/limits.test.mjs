import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, register, account } from '../support/fixture.mjs';
import { readConfig } from '../../BackEnd/config.js';
import { createMailer } from '../../BackEnd/services/mailer.js';
import { createRateLimiter } from '../../BackEnd/middleware/security.js';
import { databaseError } from '../../BackEnd/middleware/errors.js';

test('CSRF, explicit credentialed CORS, body limit and error envelopes', async t => {
  const f=await setup(t);
  assert.equal((await register(f.client)).status,201);
  for(const headers of [{'X-CSRF-Token':''},{Origin:'https://evil.test'},{'Sec-Fetch-Site':'cross-site'}]) {
    const response=await f.client.post('/api/auth/login/check',{type:'email',identifier:account.email},headers); assert.equal(response.status,403);
    const data=await response.json(); assert.equal(data.success,false); assert.equal(data.data,null);
  }
  const allowed=await f.client.post('/api/auth/login/check',{type:'email',identifier:account.email},{Origin:f.base});
  assert.equal(allowed.headers.get('access-control-allow-origin'),f.base); assert.equal(allowed.headers.get('access-control-allow-credentials'),'true');
  const large=await f.client.post('/api/auth/login',{padding:'x'.repeat(9000)});
  assert.equal(large.status,413); assert.equal((await large.json()).code,'PAYLOAD_TOO_LARGE');
  const malformed=await fetch(f.base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:'{'});
  assert.equal(malformed.status,400); assert.equal((await malformed.json()).code,'INVALID_JSON');
  const safe=databaseError({code:'ER_PARSE_ERROR',message:'secret SQL',sql:'secret SQL'});
  assert.equal(safe.status,503); assert.ok(!safe.message.includes('secret'));
});

test('check/login/forgot/reset endpoints enforce limits before expensive work', async t => {
  const f=await setup(t); await register(f.client);
  for(let n=0;n<40;n++) assert.equal((await f.client.post('/api/auth/login/check',{type:'email',identifier:account.email})).status,200);
  const blocked=await f.client.post('/api/auth/login/check',{type:'email',identifier:account.email});
  assert.equal(blocked.status,429); assert.ok(Number(blocked.headers.get('retry-after'))>0);
  for(let n=0;n<20;n++) await f.client.post('/api/auth/login',{type:'email',identifier:account.email,password:''});
  assert.equal((await f.client.post('/api/auth/login',{type:'email',identifier:account.email,password:''})).status,429);
  for(let n=0;n<5;n++) await f.client.post('/api/auth/forgot-password',{identifier:'missing@gmail.com'});
  assert.equal((await f.client.post('/api/auth/forgot-password',{identifier:'missing@gmail.com'})).status,429);
  for(let n=0;n<60;n++) await f.client.post('/api/auth/reset-password',{token:'bad'});
  assert.equal((await f.client.post('/api/auth/reset-password',{token:'bad'})).status,429);
});

test('bounded rate counters expire; production cookie flags and configuration are validated', () => {
  const limiter=createRateLimiter();
  assert.equal(limiter.take('a',1,1000,100),0); assert.equal(limiter.take('a',1,1000,101),1); assert.equal(limiter.take('a',1,1000,1100),0);
  assert.throws(()=>readConfig({DB_NAME:'la_finance'}));
  assert.throws(()=>readConfig({SESSION_TTL_MINUTES:'43201'}));
  assert.throws(()=>readConfig({APP_BASE_URL:'http://example.com',NODE_ENV:'production'}));
  assert.throws(()=>readConfig({APP_BASE_URL:'https://example.com/path'}));
  const config=readConfig({APP_BASE_URL:'https://example.com',NODE_ENV:'production',COOKIE_SECURE:'false'});
  assert.equal(config.cookieSecure,true);
  const mailer=createMailer(readConfig({})); assert.equal(mailer.ready,false); mailer.close();
});
