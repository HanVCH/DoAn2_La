const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');

test('login preserves responsive layout and opens password only after a valid account check', async ({page}) => {
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  fs.mkdirSync(path.join(__dirname,'../artifacts/screenshots'),{recursive:true});
  for(const [name,width,height] of [['desktop',1440,1024],['tablet',820,1180],['mobile',390,844]]) {
    await page.setViewportSize({width,height}); await page.goto('/login'); await page.evaluate(()=>document.fonts.ready);
    await expect(page.locator('#password-step')).toBeHidden();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    const form=await page.locator('.login-panel').boundingBox(); expect(form.width).toBe(width===390?350:488);
    await page.screenshot({path:path.join(__dirname,`../artifacts/screenshots/login-${name}.png`),fullPage:true});
  }
  await page.locator('#email').fill('login-ui@gmail.com');
  await page.getByRole('button',{name:'Tiếp tục',exact:true}).click();
  await expect(page.locator('#password-step')).toBeVisible(); await expect(page.locator('#password')).toBeFocused();
  await page.locator('#email').fill('0944444444'); await expect(page.locator('#password-step')).toBeHidden();
  await page.getByRole('button',{name:'Tiếp tục',exact:true}).click(); await expect(page.locator('#password-step')).toBeVisible();
  expect(errors).toEqual([]);
});

test('unknown identifier stays at first step; valid login uses real cookie session', async ({page}) => {
  await page.goto('/login'); await page.locator('#submit-button').click();
  await expect(page.locator('#email-error')).toBeVisible(); await expect(page.locator('#email')).toBeFocused();
  await page.locator('#email').fill('unknown@gmail.com'); await page.locator('#submit-button').click();
  await expect(page.locator('#form-status')).toHaveText('Email chưa đăng ký.'); await expect(page.locator('#password-step')).toBeHidden();
  await page.locator('#email').fill('login-ui@gmail.com'); await page.locator('#submit-button').click();
  await expect(page.locator('#password-step')).toBeVisible(); await page.locator('#password').fill('wrong'); await page.locator('#submit-button').click();
  await expect(page.locator('#form-status')).toHaveText('Mật khẩu không đúng.');
  await page.locator('#password').fill('LaCu2026'); await page.locator('#submit-button').click();
  await expect(page).toHaveURL(/\/onboarding$/);
  const me=await page.request.get('/api/auth/me'); expect(me.status()).toBe(200); expect((await me.json()).data.user.email).toBe('login-ui@gmail.com');
  expect(await page.evaluate(()=>localStorage.length)).toBe(0);
});

test('password visibility, network retry, unconnected OAuth and help keyboard remain usable', async ({page}) => {
  await page.goto('/login'); await page.locator('#email').fill('login-ui@gmail.com'); await page.locator('#submit-button').click();
  await expect(page.locator('#password-step')).toBeVisible(); await page.locator('#password').fill('keep-this');
  await page.getByRole('button',{name:'Hiện mật khẩu',exact:true}).click(); await expect(page.locator('#password')).toHaveAttribute('type','text');
  await page.route('**/api/auth/login',route=>route.abort('failed')); await page.locator('#submit-button').click();
  await expect(page.locator('#form-status')).toContainText('Không thể kết nối'); await expect(page.locator('#password')).toHaveValue('keep-this');
  await expect(page.locator('#submit-button')).toBeEnabled();
  for(const name of ['Đăng nhập bằng Gmail','Đăng nhập bằng Facebook']) {
    await page.getByRole('button',{name,exact:true}).click(); await expect(page.locator('#form-status')).toContainText('chưa được kết nối');
  }
  const help=page.getByRole('button',{name:'Cần trợ giúp?'}); await help.focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible(); await page.keyboard.press('Escape'); await expect(help).toBeFocused();
});

test('editing identifier during a check ignores the stale server response', async ({page}) => {
  let release; const gate=new Promise(resolve=>{release=resolve;});
  await page.route('**/api/auth/login/check',async route=>{await gate;await route.fulfill({status:200,json:{success:true,code:'PASSWORD_REQUIRED',data:{allow_password:true}}});});
  await page.goto('/login'); await page.locator('#email').fill('login-ui@gmail.com'); await page.locator('#submit-button').click();
  await expect(page.locator('#submit-button')).toBeDisabled(); await page.locator('#email').fill('unknown@gmail.com'); release();
  await expect(page.locator('#submit-button')).toBeEnabled(); await expect(page.locator('#password-step')).toBeHidden();
});
