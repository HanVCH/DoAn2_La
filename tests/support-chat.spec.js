const { test, expect } = require('@playwright/test');

async function openDashboard(page) {
  await page.goto('/login');
  const status = await page.evaluate(async()=>{
    const response = await fetch('/api/auth/login',{
      method:'POST',
      headers:{'Content-Type':'application/json','X-CSRF-Token':document.querySelector('meta[name="csrf-token"]').content},
      body:JSON.stringify({type:'email',identifier:'app-shell@gmail.com',password:'LaCu2026'}),
    });
    return response.status;
  });
  expect(status).toBe(200);
  await page.goto('/dashboard');
  await expect(page.locator('.support-launcher')).toBeVisible();
}

test('desktop panda drags without opening, restores position, and supports keyboard and reset',async({page})=>{
  await openDashboard(page);
  const launcher = page.locator('.support-launcher');
  const panel = page.locator('#support-panel');
  const initial = await launcher.boundingBox();
  const visible = await page.evaluate(()=>({width:visualViewport.width,height:visualViewport.height}));
  expect(initial.x+initial.width).toBeCloseTo(visible.width-16);
  expect(initial.y+initial.height).toBeCloseTo(visible.height-16);
  await expect.poll(()=>launcher.locator('img').evaluate(img=>img.complete && img.naturalWidth > 0)).toBe(true);
  await expect(panel).toBeHidden();
  await page.mouse.move(initial.x+25,initial.y+25);
  await page.mouse.down();
  await page.mouse.move(350,240,{steps:8});
  await page.mouse.up();
  await expect(panel).toBeHidden();
  const moved = await launcher.boundingBox();
  expect(moved.x).toBeLessThan(initial.x);
  await page.reload();
  await expect(launcher).toBeVisible();
  await expect.poll(()=>launcher.boundingBox()).toEqual(moved);
  await launcher.focus();
  await page.keyboard.press('Enter');
  await expect(panel).toBeVisible();
  await expect(page.getByRole('textbox',{name:'Nhập câu hỏi'})).toBeFocused();
  await page.getByRole('button',{name:'Đặt lại vị trí'}).click();
  expect(await launcher.boundingBox()).toEqual(initial);
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(launcher).toBeFocused();
});

test('transcript survives navigation and missing key, loading and retry are visible',async({page})=>{
  await openDashboard(page);
  await page.locator('.support-launcher').click();
  await page.getByRole('button',{name:'Cách thêm giao dịch?'}).click();
  const panel = page.locator('#support-panel');
  await expect(panel.getByRole('alert')).toContainText('chưa được cấu hình');
  let release;
  const gate = new Promise(resolve=>{release=resolve;});
  await page.route('**/api/support/chat',async route=>{
    expect(route.request().postDataJSON()).toEqual({message:'Cách thêm giao dịch?'});
    await gate;
    await route.fulfill({json:{data:{answer:'Chọn Thêm giao dịch trong trang Giao dịch.'}}});
  });
  await panel.getByRole('button',{name:'Thử lại'}).click();
  await expect(panel.getByRole('status')).toContainText('đang trả lời');
  await expect(panel.getByRole('button',{name:'Gửi',exact:true})).toBeDisabled();
  release();
  await expect(panel.getByRole('log')).toContainText('Chọn Thêm giao dịch');
  await page.goto('/budgets');
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('log')).toHaveText('Cách thêm giao dịch?Chọn Thêm giao dịch trong trang Giao dịch.');
  await panel.getByRole('button',{name:'Thu gọn'}).click();
  await expect(panel).toBeHidden();
  await page.locator('.support-launcher').click();
  await expect(panel.getByRole('log')).toContainText('Chọn Thêm giao dịch');
});

test('idle panda follows the viewport edges, pauses for chat and remembers the motion toggle',async({page})=>{
  await page.setViewportSize({width:900,height:600});
  await page.clock.install();
  await openDashboard(page);
  const launcher = page.locator('.support-launcher');
  const initial = await launcher.boundingBox();
  await page.clock.runFor(9000);
  const alongBottom = await launcher.boundingBox();
  expect(alongBottom.x).toBeLessThan(initial.x);
  expect(alongBottom.y).toBeCloseTo(initial.y);
  await page.clock.runFor(9000);
  const alongLeft = await launcher.boundingBox();
  expect(alongLeft.x).toBeCloseTo(16);
  expect(alongLeft.y).toBeLessThan(initial.y);
  await page.mouse.move(alongLeft.x+30,alongLeft.y+30);
  const hovered = await launcher.boundingBox();
  await page.clock.runFor(9000);
  expect(await launcher.boundingBox()).toEqual(hovered);
  await page.mouse.move(450,300);
  await page.clock.runFor(9000);
  expect((await launcher.boundingBox()).y).toBeLessThan(hovered.y);
  await launcher.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#support-panel')).toBeVisible();
  const stopped = await launcher.boundingBox();
  await page.clock.runFor(9000);
  expect(await launcher.boundingBox()).toEqual(stopped);
  await page.getByRole('button',{name:'Dừng chạy',exact:true}).click();
  await page.getByRole('button',{name:'Thu gọn',exact:true}).click();
  await page.reload();
  await expect(launcher).toBeVisible();
  await page.clock.runFor(9000);
  expect(await launcher.boundingBox()).toEqual(initial);
});

test('reduced motion keeps the panda stationary and the chat accessible',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.clock.install();
  await openDashboard(page);
  const launcher = page.locator('.support-launcher');
  const initial = await launcher.boundingBox();
  await page.clock.runFor(12000);
  expect(await launcher.boundingBox()).toEqual(initial);
  await launcher.click();
  await expect(page.locator('#support-panel')).toBeVisible();
});

test.describe('touch screen',()=>{
  test.use({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  test('touch drag, resize clamping and input fit inside the viewport',async({page,context})=>{
    await openDashboard(page);
    const launcher = page.locator('.support-launcher');
    const panel = page.locator('#support-panel');
    const before = await launcher.boundingBox();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:before.x+20,y:before.y+20}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:250,y:730}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await expect(panel).toBeHidden();
    await expect.poll(async()=>(await launcher.boundingBox()).x).toBeLessThan(before.x);
    await page.setViewportSize({width:320,height:360});
    await expect.poll(async()=>{
      const box = await launcher.boundingBox();
      return box.x >= 0 && box.y >= 0 && box.x+box.width <= 320 && box.y+box.height <= 360;
    }).toBe(true);
    await launcher.tap();
    await expect(panel).toBeVisible();
    const input = await page.getByRole('textbox',{name:'Nhập câu hỏi'}).boundingBox();
    expect(input.y+input.height).toBeLessThan(360);
    expect((await panel.boundingBox()).width).toBe(296);
  });
});
