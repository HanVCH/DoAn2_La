import { csrfHeaders } from './auth-api.js';
import { setupAuthUI } from './auth-ui.js';
import { profileInput,ageFromBirthDate } from './profile-policy.mjs';
import { fieldValue, setFieldValue } from './finance-fields.js';

const form = document.querySelector('#profile-form'), status = document.querySelector('#form-status');
const sendButton = document.querySelector('#send-otp'), confirmButton = document.querySelector('#confirm-otp');
const completeButton = document.querySelector('#complete-onboarding'), saveButton = document.querySelector('#save-profile');
const otpForm = document.querySelector('#otp-form'), otpInput = document.querySelector('#otp');
const completionStatus = document.querySelector('#completion-status');
const pending = new Map(), cooldown = new Map(), busy = new Set();
let state = null, dirty = false, nextQuotaRefresh = 0;
const channel = () => document.querySelector('input[name=channel]:checked').value;
function showStatus(message,kind = 'error') { status.textContent = message;status.dataset.state=kind;status.hidden=false; }
function showCompletionStatus(message,kind='error') {
  completionStatus.textContent=message;completionStatus.dataset.state=kind;completionStatus.hidden=false;
  completionStatus.focus({preventScroll:true});completionStatus.scrollIntoView({block:'nearest',behavior:'smooth'});
}
setupAuthUI(showStatus);
function fieldError(name,message) {
  const error = document.getElementById(`${name}-error`), input = document.getElementById(name);
  if (!error || !input) return;
  error.textContent=message;error.hidden=!message;input.setAttribute('aria-invalid',String(Boolean(message)));
}
function profileBody() { return Object.fromEntries(['fullName','birthDate','hometown','monthlyIncome','usagePurpose','usagePurposeNote'].map(name=>[name,fieldValue(form.elements[name])])); }
function validateProfile(body) {
  const {errors}=profileInput(body);
  for(const name of Object.keys(body))fieldError(name,errors[name]||'');
  if(Object.keys(errors).length){document.getElementById(Object.keys(errors)[0]).focus();return false;}
  return true;
}
async function saveProfile(body) {
  const result=await request('/api/onboarding/profile','PUT',body);state=result.data;
  dirty=JSON.stringify(profileBody())!==JSON.stringify(body);document.querySelector('#saved-note').hidden=dirty;
  return result;
}
function contactRequiredMessage() {
  return !state.verification_methods.email && !state.verification_methods.phone
    ? 'Hồ sơ đã được lưu, nhưng email và số điện thoại chưa được xác thực. Dịch vụ gửi mã email/SMS chưa được cấu hình; cần cấu hình ít nhất một kênh rồi nhận và nhập OTP trước khi vào trang chủ.'
    : 'Hồ sơ đã được lưu. Hãy mở liên kết xác thực email hoặc nhập mã SMS, rồi bấm Hoàn tất.';
}
function updateProfileHints() {
  document.querySelector('#purpose-note-field').hidden = form.elements.usagePurpose.value !== 'other';
  form.elements.usagePurposeNote.required = form.elements.usagePurpose.value === 'other';
  const age = ageFromBirthDate(fieldValue(form.elements.birthDate));
  document.querySelector('#age-hint').textContent = age === null ? 'Tuổi được tính từ ngày sinh.' : `Tuổi: ${age}`;
  const amount = fieldValue(form.elements.monthlyIncome);
  const valid = /^(?:0|[1-9]\d{0,12})(?:\.\d{1,2})?$/.test(amount);
  // String grouping preserves all 15 decimal digits; never parse currency as float.
  document.querySelector('#income-preview').textContent = valid ? `${amount.split('.')[0].replace(/\B(?=(\d{3})+(?!\d))/g,'.')}${amount.includes('.') ? ','+amount.split('.')[1] : ''} ₫ / tháng` : 'Nhập số tiền, tối đa 2 số thập phân.';
}
function updateControls() {
  if (!state) return;
  const selected = channel(), verified = Boolean(state[`${selected}_verified_at`]);
  for (const type of ['email','phone']) {
    const badge = document.querySelector(`#${type}-badge`), isVerified = Boolean(state[`${type}_verified_at`]);
    badge.textContent=isVerified?'Đã xác thực':'Chưa xác thực';badge.dataset.verified=String(isVerified);
    document.querySelector(`#${type}-availability`).textContent = isVerified ? '' : state.verification_methods[type] ? 'Có thể nhận mã xác thực' : type === 'phone' ? 'SMS chưa được cấu hình; bạn có thể dùng email' : 'Dịch vụ email chưa được cấu hình';
  }
  document.querySelector('#profile-progress').dataset.complete=String(state.profile_complete && !dirty);
  document.querySelector('#contact-progress').dataset.complete=String(state.contact_verified);
  const remaining = Math.max(0,Math.ceil(((cooldown.get(selected) || 0)-Date.now())/1000));
  const quota = state.verification_send_limit;
  const exhausted = quota?.remaining===0;
  const quotaNote = document.querySelector('#verification-send-quota');
  quotaNote.hidden = !quota || Boolean(state.contact_verified);
  if (!quotaNote.hidden) {
    const note = exhausted ? 'Đã hết lượt gửi hôm nay. Lượt gửi được làm mới lúc 00:00 giờ Việt Nam.'
      : `Còn ${quota.remaining}/${quota.limit} lượt gửi hôm nay (chung cho email và SMS).`;
    if (quotaNote.textContent!==note) quotaNote.textContent=note;
  }
  sendButton.disabled = busy.has(sendButton) || verified || !state.verification_methods[selected] || exhausted || remaining>0;
  const emailSelected = selected === 'email';
  sendButton.textContent = busy.has(sendButton) ? 'Đang gửi…' : verified ? 'Đã xác thực' : exhausted ? 'Hết lượt gửi hôm nay'
    : remaining ? `Gửi lại (${remaining}s)` : emailSelected ? 'Gửi liên kết xác thực' : 'Gửi mã xác thực';
  const challenge = pending.get(selected);
  otpForm.hidden = emailSelected || !challenge || verified;
  document.querySelector('#email-link-pending').hidden = !emailSelected || !challenge || verified;
  if (challenge) document.querySelector('#otp-expiry').textContent=`Mã gửi đến ${challenge.destination}, có hiệu lực đến ${new Date(challenge.expiresAt).toLocaleTimeString('vi-VN',{hour:'2-digit',minute:'2-digit'})}.`;
  document.querySelector('#verification-help').textContent = verified ? 'Kênh này đã được xác thực.' : !state.verification_methods[selected] ? 'Cần cấu hình dịch vụ gửi xác thực cho kênh này. ' + (emailSelected ? state.verification_configuration_message || '' : '') : emailSelected ? 'Liên kết có hiệu lực 5 phút và chỉ dùng một lần.' : 'Mã SMS có hiệu lực 5 phút. Không chia sẻ mã với người khác.';
  // Keep this action available to explain missing steps instead of silently ignoring clicks.
  completeButton.disabled = busy.size>0;
  document.querySelector('#completion-hint').textContent = dirty ? 'Bạn có thay đổi chưa lưu. Nút Hoàn tất sẽ lưu thông tin hợp lệ trước khi kiểm tra xác thực.' : !state.profile_complete ? 'Điền đủ hồ sơ. Nút Hoàn tất sẽ kiểm tra và lưu thông tin cho bạn.' : !state.contact_verified ? contactRequiredMessage() : 'Hồ sơ và liên hệ đã sẵn sàng. Hoàn tất để bắt đầu sử dụng LÁ.';
  document.querySelector('#verification-unavailable').hidden = state.contact_verified || state.verification_methods.email || state.verification_methods.phone;
}
async function request(path,method='GET',body) {
  const response=await fetch(path,{method,credentials:'include',cache:'no-store',headers:method==='GET'?{Accept:'application/json'}:csrfHeaders(),body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(25000)});
  const result=await response.json();
  if(response.status===401){window.location.assign('/login');throw new Error('Phiên đăng nhập đã hết hạn.');}
  if(!response.ok){const error=new Error(result.message || 'Chưa thể xử lý yêu cầu.');Object.assign(error,{result});throw error;}
  return result;
}
async function refresh(fill=false) {
  const result=await request('/api/onboarding');state=result.data;
  if(!state.needs_onboarding){const me=await request('/api/auth/me');window.location.assign(me.redirectTo);return;}
  pending.clear();
  for(const item of state.pending_verifications){pending.set(item.channel,item);const expiry=Date.now()+Math.min(60,item.resendAfterSeconds)*1000;cooldown.set(item.channel,Math.max(cooldown.get(item.channel)||0,expiry));}
  if(fill){
    const fields={fullName:'full_name',birthDate:'birth_date',hometown:'hometown',monthlyIncome:'monthly_income',usagePurpose:'usage_purpose',usagePurposeNote:'usage_purpose_note'};
    for(const [input,key] of Object.entries(fields))setFieldValue(form.elements[input],state[key]??'');
    if(pending.size) document.querySelector(`input[name=channel][value=${pending.keys().next().value}]`).checked=true;
    updateProfileHints();
  }
  updateControls();
}
async function perform(button,label,action,sendChannel) {
  if(busy.has(button))return;
  busy.add(button);const original=button.textContent;button.disabled=true;button.textContent=label;button.setAttribute('aria-busy','true');status.hidden=true;updateControls();
  try{await action();}
  catch(error){
    for(const [name,message]of Object.entries(error.result?.data?.errors || {}))fieldError(name,message);
    const details=error.result?.data;
    if (sendChannel && details?.sendLimit) state.verification_send_limit=details.sendLimit;
    const seconds=error.result?.code==='VERIFY_RESEND_TOO_SOON' ? details?.retryAfter : details?.cooldownSeconds;
    if (sendChannel && seconds>0) cooldown.set(sendChannel,Date.now()+Math.min(60,seconds)*1000);
    showStatus(error.message || 'Không thể kết nối máy chủ. Vui lòng thử lại.');
    if(error.result?.code==='VERIFY_ALREADY_VERIFIED')await refresh().catch(()=>{});
  }
  finally{busy.delete(button);button.disabled=false;button.textContent=original;button.removeAttribute('aria-busy');updateControls();}
}
form.addEventListener('input',event=>{dirty=true;completionStatus.hidden=true;document.querySelector('#saved-note').hidden=true;fieldError(event.target.name,'');updateProfileHints();updateControls();});
form.addEventListener('change',()=>{dirty=true;updateProfileHints();updateControls();});
form.addEventListener('submit',event=>{
  event.preventDefault();if(!state)return;
  const body=profileBody();if(!validateProfile(body))return;
  perform(saveButton,'Đang lưu…',async()=>{
    // Avoid overwriting edits made during a save: only this submitted version is saved.
    const result=await saveProfile(body);
    showStatus(result.message,'success');
  });
});
document.querySelectorAll('input[name=channel]').forEach(input=>input.addEventListener('change',()=>{otpInput.value='';fieldError('otp','');updateControls();}));
sendButton.addEventListener('click',()=>{
  const selected=channel();
  perform(sendButton,'Đang gửi mã…',async()=>{
    const result=await request('/api/onboarding/verification/send','POST',{channel:selected});
    if (result.data.sendLimit) state.verification_send_limit=result.data.sendLimit;
    pending.set(selected,result.data);cooldown.set(selected,Date.now()+Math.min(60,result.data.resendAfterSeconds)*1000);
    showStatus(result.message,'success');updateControls();if(selected==='phone' && channel()==='phone')otpInput.focus();
  },selected);
});
otpInput.addEventListener('input',()=>fieldError('otp',''));
otpForm.addEventListener('submit',event=>{
  event.preventDefault();const selected=channel(),challenge=pending.get(selected);
  if(!/^\d{6}$/.test(otpInput.value)){fieldError('otp','Vui lòng nhập đúng 6 chữ số, giữ cả số 0 ở đầu.');otpInput.focus();return;}
  if(!challenge)return;
  perform(confirmButton,'Đang xác thực…',async()=>{const result=await request('/api/onboarding/verification/confirm','POST',{challengeId:challenge.challengeId,otp:otpInput.value});state=result.data;pending.delete(selected);otpInput.value='';completionStatus.hidden=true;showStatus(result.message,'success');});
});
completeButton.addEventListener('click',()=>{
  if(!state || busy.size)return;
  const body=profileBody();completionStatus.hidden=true;
  if(!validateProfile(body)){
    completionStatus.textContent='Thông tin hồ sơ chưa hợp lệ. Vui lòng kiểm tra các trường được đánh dấu.';completionStatus.dataset.state='error';completionStatus.hidden=false;
    return;
  }
  perform(completeButton,'Đang hoàn tất…',async()=>{
    try {
      if(dirty || !state.profile_complete)await saveProfile(body);
      else {const result=await request('/api/onboarding');state=result.data;}
      if(dirty){showCompletionStatus('Bạn vừa sửa thông tin trong lúc lưu. Hãy kiểm tra lại và bấm Hoàn tất.');return;}
      if(!state.contact_verified){showCompletionStatus(contactRequiredMessage());return;}
      const result=await request('/api/onboarding/complete','POST',{});
      if(result.code!=='ONBOARDING_COMPLETED' || result.data?.needs_onboarding!==false || typeof result.redirectTo!=='string' || !result.redirectTo.startsWith('/') || result.redirectTo.startsWith('//') || /[\\\s\u0000-\u001f]/.test(result.redirectTo))throw new Error('Chưa thể xác nhận hoàn tất thiết lập. Vui lòng thử lại.');
      showCompletionStatus('Đã hoàn tất thiết lập. Đang chuyển tới trang chủ…','success');window.location.assign(result.redirectTo);
    } catch(error){showCompletionStatus(error.message || 'Chưa thể hoàn tất thiết lập. Vui lòng thử lại.');throw error;}
  });
});
function returnToLogin(event) {
  if (busy.size) return;
  perform(event.currentTarget,'Đang đăng xuất…',async()=>{
    await request('/api/auth/logout','POST',{});
    window.location.assign('/login');
  });
}
document.querySelector('#logout-button').addEventListener('click',returnToLogin);
const returnButton = document.querySelector('#return-to-login');
returnButton.addEventListener('click',returnToLogin);
returnButton.disabled = false;
for(const input of form.querySelectorAll('input'))input.readOnly=true;
form.elements.usagePurpose.disabled=true;saveButton.disabled=true;sendButton.disabled=true;
showStatus('Đang tải thông tin của bạn…','info');
refresh(true).then(()=>{status.hidden=true;for(const input of form.querySelectorAll('input'))input.readOnly=false;form.elements.usagePurpose.disabled=false;saveButton.disabled=false;}).catch(error=>showStatus(error.message));
setInterval(()=>{
  updateControls();
  const now=Date.now();
  if (!busy.size && now>=nextQuotaRefresh && now>=Date.parse(state?.verification_send_limit?.resetAt)) {
    nextQuotaRefresh=now+30000;
    refresh().catch(()=>{});
  }
},1000);
window.addEventListener('focus', () => {
  if (pending.has('email') && !busy.size) refresh().catch(() => {});
});
