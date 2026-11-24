import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSms } from '../../BackEnd/services/sms.js';

test('SMS adapter is opt-in and sends exact OTP only to configured Twilio over HTTPS',async()=>{
  const config={sms:{enabled:true,accountSid:'AC'+'a'.repeat(32),authToken:'test-only-secret',from:'+12025550100'}};
  let calls=0;
  const adapter=createSms(config,async(url,request)=>{
    calls++;assert.equal(url,`https://api.twilio.com/2010-04-01/Accounts/${config.sms.accountSid}/Messages.json`);
    assert.equal(request.redirect,'error');assert.equal(request.method,'POST');
    assert.equal(request.body.get('To'),'+84901234567');assert.equal(request.body.get('From'),config.sms.from);assert.match(request.body.get('Body'),/012345/);
    return{ok:true,json:async()=>({sid:'SMtest',status:'queued'})};
  });
  assert.equal(adapter.ready,true);await adapter.sendOtp('+84901234567','012345');assert.equal(calls,1);
  const disabled=createSms({sms:{...config.sms,enabled:false}},()=>{throw new Error('Must not contact provider');});
  assert.equal(disabled.ready,false);await assert.rejects(disabled.sendOtp('+84901234567','012345'),/SMS_NOT_CONFIGURED/);
  const failure=createSms(config,async()=>({ok:false,json:async()=>({message:'provider secret detail'})}));
  await assert.rejects(failure.sendOtp('+84901234567','012345'),error=>error.message==='SMS_SEND_FAILED');
});
