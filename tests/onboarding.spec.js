const {test,expect}=require('@playwright/test');
const path=require('node:path');
const password='LaProfile123';
async function createAccount(page,email,phone){
  await page.goto('/register');
  const status=await page.evaluate(async({email,phone,password})=>{
    const response=await fetch('/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':document.querySelector('meta[name=csrf-token]').content},body:JSON.stringify({email,phone,password,confirmPassword:password})});return response.status;
  },{email,phone,password});expect(status).toBe(201);
}
async function login(page,email){
  await page.goto('/login');await page.locator('#email').fill(email);await page.locator('#submit-button').click();await expect(page.locator('#password-step')).toBeVisible();await page.locator('#password').fill(password);await page.locator('#submit-button').click();
}
async function fillProfile(page){
  await expect(page.locator('#save-profile')).toBeEnabled();
  await page.locator('#fullName').fill('Nguyễn Minh Anh');await page.locator('#birthDate').fill('15/05/01');await page.locator('#hometown').fill('Đà Nẵng');await page.locator('#monthlyIncome').fill('0');await page.locator('#usagePurpose').selectOption('other');await page.locator('#usagePurposeNote').fill('Dành dụm cho chuyến đi đầu tiên');
}
async function mails(request,email){return(await request.get('/__test/mail?to='+encodeURIComponent(email))).json();}
async function verifyEmail(page,request,email){
  const mail=(await mails(request,email)).find(m=>m.text.includes('/onboarding/verify-email?'));
  const link=mail.text.match(/https?:\/\/\S+\/onboarding\/verify-email\?token=\S+/)[0];
  await page.goto(link);
  await page.locator('form[action="/onboarding/verify-email"] button').click();
  await expect(page.locator('h1')).toHaveText('Email đã xác thực');
  await page.goto('/onboarding');
}

test('return to login signs out from an empty or partially filled profile without submitting it',async({page})=>{
  const email='onboarding-return@test.com';
  await createAccount(page,email,'0906000009');
  await login(page,email);
  const profileWrites=[];
  page.on('request',request=>{
    if (request.method()!=='GET' && /\/api\/onboarding\/(profile|complete)$/.test(request.url())) profileWrites.push(request.url());
  });
  for (const name of ['', 'Tên chưa lưu']) {
    await expect(page.locator('#save-profile')).toBeEnabled();
    await expect(page.locator('#fullName')).toHaveValue('');
    if (name) await page.locator('#fullName').fill(name);
    await page.getByRole('button',{name:'Quay về đăng nhập',exact:true}).click();
    await expect(page).toHaveURL(/\/login$/);
    expect((await page.request.get('/api/auth/me')).status()).toBe(401);
    await login(page,email);
    await expect(page).toHaveURL(/\/onboarding$/);
  }
  await expect(page.locator('#fullName')).toHaveValue('');
  expect(profileWrites).toEqual([]);
});

test('complete setup saves profile, resumes OTP after reload, enters home and skips setup on later login',async({page,request})=>{
  const email='onboarding-complete@test.com';await createAccount(page,email,'0906000001');await login(page,email);await expect(page).toHaveURL(/\/onboarding$/);
  await fillProfile(page);await expect(page.locator('#age-hint')).toContainText('Tuổi:');await expect(page.locator('#income-preview')).toHaveText('0 ₫ / tháng');
  await page.getByRole('button',{name:'Chọn ngày, tháng và năm'}).click();
  const picker=page.locator('.finance-date-picker');
  await picker.getByLabel('Năm',{exact:true}).selectOption('2000');
  await picker.getByLabel('Tháng',{exact:true}).selectOption('02');
  await picker.getByLabel('Ngày',{exact:true}).selectOption('29');
  await picker.getByRole('button',{name:'Áp dụng'}).click();
  await expect(page.locator('#birthDate')).toHaveValue('29/02/00');
  await page.locator('#save-profile').click();await expect(page.locator('#saved-note')).toBeVisible();await page.reload();await expect(page.locator('#fullName')).toHaveValue('Nguyễn Minh Anh');await expect(page.locator('#monthlyIncome')).toHaveValue('0,00');await expect(page.locator('#purpose-note-field')).toBeVisible();
  await expect(page.locator('#verification-send-quota')).toContainText('5/5');
  await page.locator('#send-otp').click();await expect(page.locator('#email-link-pending')).toBeVisible();await expect(page.locator('#send-otp')).toBeDisabled();
  await expect(page.locator('#verification-send-quota')).toContainText('4/5');
  await page.reload();await expect(page.locator('#email-link-pending')).toBeVisible();
  await expect(page.locator('#otp-form')).toBeHidden();await verifyEmail(page,request,email);await expect(page.locator('#email-badge')).toHaveText('Đã xác thực');await expect(page.locator('#phone-badge')).toHaveText('Chưa xác thực');
  await expect(page.locator('#complete-onboarding')).toBeEnabled();await page.locator('#complete-onboarding').click();await expect(page).toHaveURL('http://127.0.0.1:3100/dashboard');await expect(page.locator('#app-main h1')).toContainText('Nguyễn Minh Anh');
  expect((await page.request.get('/api/home')).status()).toBe(200);
  await expect(page.locator('#app-root')).toBeVisible();await page.locator('#account-toggle').click();await page.locator('#logout-button').click();await expect(page).toHaveURL(/\/login$/);await login(page,email);await expect(page).toHaveURL('http://127.0.0.1:3100/dashboard');
  expect((await mails(request,email)).filter(m=>m.text.includes('/onboarding/verify-email?')).length).toBe(1);await page.goto('/onboarding');await expect(page).toHaveURL('http://127.0.0.1:3100/dashboard');
});

test('verification shows the daily cap instead of a long resend countdown',async({page})=>{
  const email='onboarding-daily-quota@test.com';
  await createAccount(page,email,'0906000008');
  await login(page,email);
  await expect(page.locator('#verification-send-quota')).toContainText('5/5');
  let requests=0;
  await page.route('**/api/onboarding/verification/send',route=>{
    requests++;
    return route.fulfill({status:429,json:requests===1
      ? {code:'RATE_LIMITED',message:'Thử lại sau.',data:{retryAfter:3590}}
      : {code:'VERIFY_DAILY_LIMIT',message:'Hết lượt hôm nay.',data:{sendLimit:{limit:5,remaining:0,resetAt:new Date(Date.now()+3600000).toISOString()}}}});
  });
  const send=page.locator('#send-otp');
  await send.click();
  await expect(page.locator('#form-status')).toContainText('Thử lại sau.');
  await expect(send).toHaveText('Gửi liên kết xác thực');
  await send.click();
  await expect(send).toHaveText('Hết lượt gửi hôm nay');
  await expect(send).toBeDisabled();
  await expect(page.locator('#verification-send-quota')).toContainText('00:00 giờ Việt Nam');
});

test('incomplete accounts cannot bypass setup through URL, API, localStorage or forged flags',async({page})=>{
  await createAccount(page,'onboarding-gate@test.com','0906000002');await login(page,'onboarding-gate@test.com');await expect(page).toHaveURL(/\/onboarding$/);
  await page.evaluate(()=>localStorage.setItem('onboarding_completed','true'));await page.goto('/');await expect(page).toHaveURL(/\/onboarding$/);
  const denied=await page.request.get('/api/transactions');expect(denied.status()).toBe(403);expect((await denied.json()).code).toBe('ONBOARDING_REQUIRED');
  const result=await page.evaluate(async()=>{const response=await fetch('/api/onboarding/complete',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':document.querySelector('meta[name=csrf-token]').content},body:JSON.stringify({completed:true,verified:true,user_id:'1'})});return response.status;});expect(result).toBe(400);
  await page.locator('#logout-button').click();await expect(page).toHaveURL(/\/login$/);await page.goto('/onboarding');await expect(page).toHaveURL(/\/login$/);
});

test('profile validation accepts zero and Complete saves valid edits before entering home',async({page,request})=>{
  const email='onboarding-validation@test.com';await createAccount(page,email,'0906000003');await login(page,email);await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.locator('#save-profile')).toBeEnabled();await page.locator('#save-profile').click();await expect(page.locator('#fullName-error')).toBeVisible();await expect(page.locator('#birthDate-error')).toBeVisible();await expect(page.locator('#monthlyIncome-error')).toBeVisible();
  await fillProfile(page);await page.locator('#monthlyIncome').fill('-1');await page.locator('#usagePurposeNote').fill('');await page.locator('#save-profile').click();await expect(page.locator('#monthlyIncome-error')).toBeVisible();await expect(page.locator('#usagePurposeNote-error')).toBeVisible();
  await page.locator('#monthlyIncome').fill('1234567,50');
  await expect(page.locator('#monthlyIncome')).toHaveValue('1.234.567,50');
  await page.locator('#monthlyIncome').fill('0');await page.locator('#usagePurposeNote').fill('Tiết kiệm');await page.locator('#save-profile').click();await expect(page.locator('#saved-note')).toBeVisible();
  await page.locator('#send-otp').click();await expect(page.locator('#email-link-pending')).toBeVisible();await verifyEmail(page,request,email);await expect(page.locator('#email-badge')).toHaveText('Đã xác thực');
  await expect(page.locator('#complete-onboarding')).toBeEnabled();await page.locator('#fullName').fill('Hồ sơ vừa sửa');await expect(page.locator('#completion-hint')).toContainText('chưa lưu');
  await page.locator('#complete-onboarding').click();await expect(page).toHaveURL(/\/dashboard$/);await expect(page.locator('#app-main h1')).toContainText('Hồ sơ vừa sửa');
});

test('Complete saves filled profile and explains unverified contacts instead of silently doing nothing',async({page})=>{
  const email='onboarding-unverified@test.com';await createAccount(page,email,'0906000005');await login(page,email);await expect(page).toHaveURL(/\/onboarding$/);
  await fillProfile(page);await page.locator('#complete-onboarding').click();
  await expect(page.locator('#completion-status')).toContainText('Hồ sơ đã được lưu');await expect(page.locator('#completion-status')).toContainText('SMS');
  await expect(page).toHaveURL(/\/onboarding$/);await expect(page.locator('#complete-onboarding')).toBeEnabled();
  const state=(await (await page.request.get('/api/onboarding')).json()).data;expect(state.profile_complete).toBe(true);expect(state.contact_verified).toBe(false);expect(state.onboarding_completed_at).toBe(null);
  expect((await page.request.get('/api/home')).status()).toBe(403);
});

test('missing delivery configuration is visible next to verification and completion (configuration response mock)',async({page})=>{
  await createAccount(page,'onboarding-no-delivery@test.com','0906000006');
  await page.route(/\/api\/onboarding(?:\/profile)?$/,async route=>{const response=await route.fetch();const result=await response.json();result.data.verification_methods={email:false,phone:false};await route.fulfill({response,json:result});});
  await login(page,'onboarding-no-delivery@test.com');await expect(page).toHaveURL(/\/onboarding$/);await expect(page.locator('#verification-unavailable')).toBeVisible();
  await fillProfile(page);await page.locator('#complete-onboarding').click();await expect(page.locator('#completion-status')).toContainText('chưa được cấu hình');await expect(page.locator('#completion-status')).toContainText('OTP');
  await expect(page).toHaveURL(/\/onboarding$/);await expect(page.locator('#complete-onboarding')).toBeEnabled();expect((await page.request.get('/api/home')).status()).toBe(403);
});

test('completion server errors remain visible near the button and allow retry (failure response mock)',async({page,request})=>{
  const email='onboarding-retry-complete@test.com';await createAccount(page,email,'0906000007');await login(page,email);await expect(page).toHaveURL(/\/onboarding$/);
  await fillProfile(page);await page.locator('#save-profile').click();await expect(page.locator('#saved-note')).toBeVisible();
  await page.locator('#send-otp').click();await expect(page.locator('#email-link-pending')).toBeVisible();await verifyEmail(page,request,email);await expect(page.locator('#email-badge')).toHaveText('Đã xác thực');
  await page.route('**/api/onboarding/complete',route=>route.fulfill({status:503,json:{success:false,code:'SERVICE_UNAVAILABLE',message:'Chưa thể hoàn tất. Vui lòng thử lại.',data:null}}));
  await page.locator('#complete-onboarding').click();await expect(page.locator('#completion-status')).toHaveText('Chưa thể hoàn tất. Vui lòng thử lại.');await expect(page.locator('#complete-onboarding')).toBeEnabled();await expect(page).toHaveURL(/\/onboarding$/);
  await page.unroute('**/api/onboarding/complete');await page.locator('#complete-onboarding').click();await expect(page).toHaveURL(/\/dashboard$/);
});

test('onboarding uses the existing palette/fonts and remains usable on desktop/tablet/mobile',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));await createAccount(page,'onboarding-layout@test.com','0906000004');await login(page,'onboarding-layout@test.com');await expect(page).toHaveURL(/\/onboarding$/);await expect(page.locator('#save-profile')).toBeEnabled();
  for(const[name,width,height]of[['desktop',1440,1024],['tablet',820,1180],['mobile',390,844],['small-mobile',320,640]]){
    await page.setViewportSize({width,height});await page.evaluate(()=>document.fonts.ready);await expect(page.locator('h1')).toContainText('Chào mừng');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await expect(page.locator('#fullName')).toBeVisible();expect(await page.locator('#fullName').evaluate(el=>getComputedStyle(el).fontFamily)).toContain('Noto Sans');await page.screenshot({path:path.join(__dirname,`../artifacts/screenshots/onboarding-${name}.png`),fullPage:true});
  }
  await page.locator('input[name=channel][value=phone]').check();await expect(page.locator('#send-otp')).toBeDisabled();await expect(page.locator('#phone-availability')).toContainText('SMS chưa được cấu hình');
  expect(errors).toEqual([]);
});
