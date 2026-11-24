const { test, expect }=require('@playwright/test');
const path=require('node:path');
async function getToken(request,email) {
  const messages=await (await request.get('/__test/mail?to='+encodeURIComponent(email))).json();
  return messages.filter(m=>m.subject.includes('Yêu cầu')).at(-1).text.match(/token=([a-f0-9]{64})/)[1];
}
test('recovery layouts do not overflow on desktop/tablet/mobile',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  for(const [name,width,height] of [['desktop',1440,1024],['tablet',820,1180],['mobile',390,844]]) {
    await page.setViewportSize({width,height});await page.goto('/forgot-password');await page.evaluate(()=>document.fonts.ready);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await expect(page.locator('#identifier')).toHaveAttribute('autocomplete','username');
    await page.screenshot({path:path.join(__dirname,`../artifacts/screenshots/forgot-password-${name}.png`),fullPage:true});
  }
  expect(errors).toEqual([]);
});
test('invalid inputs stay on form and unknown account returns to login',async({page})=>{
  await page.goto('/forgot-password');await page.locator('button[type=submit]').click();await expect(page.locator('#identifier-error')).toBeVisible();
  await page.locator('#identifier').fill('bad');await page.locator('button[type=submit]').click();await expect(page.locator('#identifier-error')).toContainText('hợp lệ');
  await page.locator('#identifier').fill('unknown@gmail.com');await page.locator('button[type=submit]').click();await expect(page).toHaveURL(/\/login$/);
});
test('real SMTP sent state, reset validation and password toggles',async({page,request})=>{
  await page.goto('/forgot-password');await page.locator('#identifier').fill('0911111111');await page.locator('button[type=submit]').click();
  await expect(page.getByRole('heading',{name:'Kiểm tra hộp thư của bạn'})).toBeVisible();
  await expect(page.locator('#masked-email')).toHaveText('r***@gmail.com');await expect(page.locator('#resend-button')).toBeDisabled();
  const token=await getToken(request,'recovery-ui@gmail.com');await page.goto('/reset-password?token='+token);
  await expect(page.locator('#recovery-reset-form')).toBeVisible();await expect(page).toHaveURL(/\/reset-password$/);
  await page.locator('#password').fill('LaMoi2026');await page.locator('#passwordConfirmation').fill('different');
  await page.locator('button[type=submit]').click();await expect(page.locator('#passwordConfirmation-error')).toContainText('chưa trùng khớp');
  await page.getByRole('button',{name:'Hiện mật khẩu mới',exact:true}).click();await expect(page.locator('#password')).toHaveAttribute('type','text');
  await page.goto('/reset-password?token=bad');await expect(page.getByRole('alert')).toHaveText('Liên kết không hợp lệ, đã được sử dụng hoặc đã hết hạn.');
  await expect(page.getByRole('link',{name:'Yêu cầu liên kết mới'})).toBeVisible();
});
test('complete recovery resets real SQL password and allows login again',async({page,request})=>{
  await page.goto('/forgot-password');await page.locator('#identifier').fill('recovery-flow@gmail.com');await page.locator('button[type=submit]').click();
  await expect(page.getByRole('heading',{name:'Kiểm tra hộp thư của bạn'})).toBeVisible();
  const token=await getToken(request,'recovery-flow@gmail.com');await page.goto('/reset-password?token='+token);
  await page.locator('#password').fill('LaMoi2026');await page.locator('#passwordConfirmation').fill('LaMoi2026');await page.locator('button[type=submit]').click();
  await expect(page).toHaveURL(/\/login$/);await page.locator('#email').fill('recovery-flow@gmail.com');await page.locator('button[type=submit]').click();
  await expect(page.locator('#password-step')).toBeVisible();await page.locator('#password').fill('LaCu2026');await page.locator('button[type=submit]').click();
  await expect(page.locator('#form-status')).toHaveText('Mật khẩu không đúng.');await page.locator('#password').fill('LaMoi2026');await page.locator('button[type=submit]').click();
  await expect(page).toHaveURL(/\/onboarding$/);
  const response=await page.request.get('/api/auth/me');expect(response.status()).toBe(200);expect((await response.json()).data.user.email).toBe('recovery-flow@gmail.com');
  await page.goto('/reset-password?token='+token);await expect(page.getByRole('alert')).toContainText('đã được sử dụng');
});
test('OAuth-only account receives appropriate guidance and no reset form',async({page})=>{
  await page.goto('/forgot-password');await page.locator('#identifier').fill('0933333333');await page.locator('button[type=submit]').click();
  await expect(page.locator('#form-status')).toContainText('chưa có mật khẩu');await expect(page.locator('#sent-state')).toBeHidden();
});
test('SMTP error preserves form and loading prevents duplicate requests (mock response)',async({page})=>{
  await page.goto('/forgot-password');let count=0,release;const gate=new Promise(resolve=>{release=resolve;});
  await page.route('**/forgot-password',async route=>{if(route.request().method()!=='POST')return route.continue();count++;await gate;await route.fulfill({status:502,json:{success:false,code:'MAIL_SEND_FAILED',message:'Chưa thể gửi email.',data:null}});});
  await page.locator('#identifier').fill('recovery-ui@gmail.com');await page.locator('button[type=submit]').click();await expect(page.locator('button[type=submit]')).toBeDisabled();
  await page.locator('#recovery-request-form').evaluate(form=>form.requestSubmit());expect(count).toBe(1);release();
  await expect(page.locator('#form-status')).toContainText('Chưa thể gửi email');await expect(page.locator('#identifier')).toHaveValue('recovery-ui@gmail.com');await expect(page.locator('button[type=submit]')).toBeEnabled();
});
