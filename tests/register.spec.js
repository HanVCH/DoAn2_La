const { test,expect }=require('@playwright/test');
const path=require('node:path'),fs=require('node:fs');
async function fill(page,email='new-browser@gmail.com',phone='0987654321') {
  await page.locator('#email').fill(email);await page.locator('#phone').fill(phone);
  await page.locator('#password').fill('LaXanh2026');await page.locator('#passwordConfirmation').fill('LaXanh2026');await page.locator('#acceptedTerms').check();
}
test('registration retains desktop/tablet/mobile layout and local fonts',async({page})=>{
  fs.mkdirSync(path.join(__dirname,'../artifacts/screenshots'),{recursive:true});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  for(const [name,width,height] of [['desktop',1440,1024],['tablet',820,1180],['mobile',390,844]]) {
    await page.setViewportSize({width,height});await page.goto('/register');await page.evaluate(()=>document.fonts.ready);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    const form=await page.locator('.registration').boundingBox();expect(form.width).toBe(name==='mobile'?350:488);
    expect(await page.locator('#email').evaluate(el=>getComputedStyle(el).fontFamily)).toContain('Noto Sans');
    await page.screenshot({path:path.join(__dirname,`../artifacts/screenshots/register-${name}.png`),fullPage:true});
  }
  expect(errors).toEqual([]);
});
test('empty form and invalid values show errors and preserve inputs',async({page})=>{
  await page.goto('/register');await page.locator('#submit-button').click();await expect(page.locator('.field-error:visible')).toHaveCount(5);await expect(page.locator('#email')).toBeFocused();
  await fill(page);await page.locator('#password').fill('short');await page.locator('#submit-button').click();await expect(page.locator('#password-error')).toContainText('8 ký tự');
  await page.locator('#password').fill('a'.repeat(73));await page.locator('#submit-button').click();await expect(page.locator('#password-error')).toContainText('72 byte');
  await page.locator('#password').fill('LaXanh2026');await page.locator('#passwordConfirmation').fill('different');await page.locator('#submit-button').click();
  await expect(page.locator('#passwordConfirmation-error')).toContainText('chưa trùng khớp');
});
test('registration creates a real SQL account, redirects to login, then permits phone login',async({page})=>{
  await page.goto('/register');await fill(page);const response=page.waitForResponse('**/api/auth/register');await page.locator('#submit-button').click();
  expect((await response).status()).toBe(201);await expect(page).toHaveURL(/\/login$/);
  await page.locator('#email').fill('84 987-654-321');await page.locator('#submit-button').click();await expect(page.locator('#password-step')).toBeVisible();
  await page.locator('#password').fill('LaXanh2026');await page.locator('#submit-button').click();await expect(page).toHaveURL(/\/onboarding$/);
  expect((await page.request.get('/api/auth/me')).status()).toBe(200);expect(await page.evaluate(()=>localStorage.length)).toBe(0);
});
test('password visibility is independent; loading blocks duplicates and maps API field errors',async({page})=>{
  await page.goto('/register');await fill(page);
  await page.getByRole('button',{name:'Hiện mật khẩu',exact:true}).click();await expect(page.locator('#password')).toHaveAttribute('type','text');await expect(page.locator('#passwordConfirmation')).toHaveAttribute('type','password');
  let count=0,release;const gate=new Promise(resolve=>{release=resolve;});
  await page.route('**/api/auth/register',async route=>{count++;await gate;await route.fulfill({status:409,json:{success:false,code:'EMAIL_ALREADY_USED',message:'Email đã được sử dụng.',data:{errors:{email:'Email đã được sử dụng.'}}}});});
  await page.locator('#submit-button').click();await expect(page.locator('#submit-button')).toBeDisabled();await page.locator('form').evaluate(form=>form.requestSubmit());expect(count).toBe(1);
  release();await expect(page.locator('#email-error')).toHaveText('Email đã được sử dụng.');await expect(page.locator('#submit-button')).toBeEnabled();await expect(page.locator('#password')).toHaveValue('LaXanh2026');
});
test('unconnected social providers, help and policy links remain accessible',async({page})=>{
  await page.goto('/register');
  for(const name of ['Google (Gmail)','Facebook']) {
    await page.getByRole('button',{name,exact:true}).click();await expect(page.locator('#form-status')).toContainText('chưa được kết nối');
  }
  const help=page.getByRole('button',{name:'Cần trợ giúp?'});await help.focus();await page.keyboard.press('Enter');await expect(page.getByRole('dialog')).toBeVisible();await page.keyboard.press('Escape');await expect(help).toBeFocused();
  for(const url of ['/terms','/privacy'])expect((await page.request.get(url)).status()).toBe(501);
});
