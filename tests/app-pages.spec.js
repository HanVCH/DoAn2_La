const { test, expect } = require('@playwright/test');
const path = require('node:path');
const pages = [
  ['/dashboard','Tổng quan'],['/transactions','Giao dịch'],['/budgets','Ngân sách'],['/goals','Mục tiêu'],['/wallets','Ví của tôi'],['/reports','Báo cáo'],['/settings','Cài đặt'],['/help','Trợ giúp'],['/account','Tài khoản'],
];
async function signIn(page,email='app-shell@gmail.com') {
  await page.goto('/login');
  const result=await page.evaluate(async email=>{
    const response=await fetch('/api/auth/login',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json','X-CSRF-Token':document.querySelector('meta[name=csrf-token]').content},body:JSON.stringify({type:'email',identifier:email,password:'LaCu2026'})});
    return {status:response.status,data:await response.json()};
  },email);
  expect(result.status).toBe(200);return result.data;
}
test('all nine pages enforce auth and onboarding on direct URLs',async({page})=>{
  for(const[route]of pages){const response=await page.request.get(route,{maxRedirects:0});expect(response.status()).toBe(302);expect(response.headers().location).toBe('/login');}
  await signIn(page,'login-ui@gmail.com');
  for(const[route]of pages){const response=await page.request.get(route,{maxRedirects:0});expect(response.status()).toBe(302);expect(response.headers().location).toBe('/onboarding');}
  const api=await page.request.get('/api/reports');expect(api.status()).toBe(403);expect((await api.json()).code).toBe('ONBOARDING_REQUIRED');
});
test('navigation, direct refresh, history, account identity and honest empty states stay consistent',async({page})=>{
  const errors=[],financeRequests=[];page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{if(/\/api\/(transactions|budgets|goals|wallets|reports|finance)/.test(request.url()))financeRequests.push(request.method());});
  const login=await signIn(page);expect(login.redirectTo).toBe('/dashboard');
  await page.goto('/');await expect(page).toHaveURL(/\/dashboard$/);await expect(page.locator('#app-root')).toBeVisible();
  await expect(page.locator('#app-main h1')).toContainText('Trần Thảo Nguyên');await expect(page.locator('.stat-value')).toHaveText(['—','—','—','—']);
  await expect(page.locator('#app-main')).not.toContainText('18.000.000');
  for(const[route,label]of pages){
    await page.locator(`#app-sidebar a[href="${route}"]:not(.app-brand)`).click();await expect(page).toHaveURL(new RegExp(route+'$'));await expect(page.locator('#app-root')).toBeVisible();
    await expect(page).toHaveTitle(label+' · LÁ');await expect(page.locator('.topbar-title')).toHaveText(label);await expect(page.locator('#app-sidebar [aria-current=page]')).toHaveCount(1);await expect(page.locator('#app-sidebar [aria-current=page]')).toHaveAttribute('href',route);
  }
  await expect(page.locator('.profile-details')).toContainText('app-shell@gmail.com');await expect(page.locator('.profile-details')).toContainText('+84955555555');
  await page.reload();await expect(page.locator('#app-root')).toBeVisible();await page.goBack();await expect(page).toHaveURL(/\/help$/);await expect(page.locator('#app-root')).toBeVisible();await page.goForward();await expect(page).toHaveURL(/\/account$/);await expect(page.locator('#app-root')).toBeVisible();
  await page.getByRole('link',{name:'Sửa hồ sơ trong Cài đặt',exact:true}).click();
  await expect(page).toHaveURL(/\/settings#settings-profile$/);
  await expect(page.getByRole('heading',{name:'Hồ sơ cá nhân'})).toBeVisible();
  expect(financeRequests).toContain('GET');expect(financeRequests.every(method=>method==='GET')).toBe(true);expect(errors).toEqual([]);
});
test('session checking blocks content; network failures offer retry and never assume completion',async({page})=>{
  await signIn(page);let release;
  const gate=new Promise(resolve=>{release=resolve;});let attempt=0;
  await page.route('**/api/auth/me',async route=>{attempt++;if(attempt===1){await gate;return route.abort('failed');}return route.continue();});
  await page.goto('/dashboard');await expect(page.locator('#session-loading')).toBeVisible();await expect(page.locator('#app-root')).toBeHidden();release();
  await expect(page.locator('#session-error')).toBeVisible();await expect(page.locator('#app-root')).toBeHidden();await page.getByRole('button',{name:'Thử lại',exact:true}).click();await expect(page.locator('#app-root')).toBeVisible();
});
test('mobile drawer traps/restores focus, closes on Esc/outside/navigation and does not overflow',async({page})=>{
  await page.setViewportSize({width:390,height:844});await signIn(page);await page.goto('/dashboard');await expect(page.locator('#app-root')).toBeVisible();
  const menu=page.getByRole('button',{name:'Mở menu điều hướng'});await menu.click();await expect(page.locator('#app-sidebar')).toHaveAttribute('aria-modal','true');
  await expect(page.getByRole('button',{name:'Đóng menu',exact:true})).toBeFocused();
  await page.keyboard.press('Escape');await expect(menu).toBeFocused();await expect(menu).toHaveAttribute('aria-expanded','false');
  await menu.click();await page.locator('#app-sidebar a[href="/account"]').focus();await page.keyboard.press('Tab');await expect(page.locator('#app-sidebar .app-brand')).toBeFocused();
  await page.locator('#drawer-overlay').click({position:{x:370,y:100}});await expect(menu).toHaveAttribute('aria-expanded','false');
  await menu.click();await page.locator('#app-sidebar a[href="/transactions"]').click();await expect(page).toHaveURL(/\/transactions$/);await expect(page.locator('#app-root')).toBeVisible();await expect(menu).toHaveAttribute('aria-expanded','false');
  for(const[name,width,height]of[['mobile',390,844],['small-mobile',320,640],['tablet',820,1180],['desktop',1440,1024]]){
    await page.setViewportSize({width,height});await page.goto('/dashboard');await expect(page.locator('#app-root')).toBeVisible();await page.evaluate(()=>document.fonts.ready);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:path.join(__dirname,`../artifacts/screenshots/dashboard-${name}.png`),fullPage:true});
  }
});
test('logout revokes the actual session and prevents access to every app page',async({page})=>{
  await signIn(page);await page.goto('/dashboard');await expect(page.locator('#app-root')).toBeVisible();await page.locator('#account-toggle').click();await expect(page.locator('#account-menu')).toBeVisible();
  await page.keyboard.press('Escape');await expect(page.locator('#account-toggle')).toBeFocused();await page.locator('#account-toggle').click();await page.locator('#logout-button').click();await expect(page).toHaveURL(/\/login$/);
  expect((await page.request.get('/api/auth/me')).status()).toBe(401);
  for(const[route]of pages){const response=await page.request.get(route,{maxRedirects:0});expect(response.headers().location).toBe('/login');}
});

test('transactions support adding, editing, retained filters and deleted history on mobile',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await signIn(page);
  await page.goto('/transactions');
  await expect(page.locator('#tx-state')).toContainText('Chưa có giao dịch');
  await expect(page.getByLabel('Từ ngày')).toBeHidden();
  await page.getByRole('button',{name:'Bộ lọc',exact:true}).click();
  await expect(page.getByLabel('Từ ngày')).toBeVisible();
  await page.getByRole('button',{name:'Bộ lọc',exact:true}).click();
  await page.getByRole('button',{name:'Thêm giao dịch',exact:true}).click();
  await page.getByRole('button',{name:'Tạo ví và danh mục mặc định'}).click();
  await expect(page.locator('#tx-notice')).toContainText('Đã cập nhật');
  const form=page.locator('#tx-form');
  await expect(form).toBeVisible();
  await expect(form.getByRole('radio',{name:'Khoản chi'})).toBeChecked();
  await form.getByRole('button',{name:'Lưu giao dịch'}).click();
  await expect(page.locator('#tx-field-amount')).toBeVisible();
  await expect(form.getByLabel('Số tiền VND')).toBeFocused();
  await form.getByText('Khoản thu',{exact:true}).click();
  await expect(form.getByRole('radio',{name:'Khoản thu'})).toBeChecked();
  await expect(form.getByLabel('Danh mục').locator('option')).toHaveText(['Chọn danh mục','Lương','Thu khác']);
  await form.getByText('Khoản chi',{exact:true}).click();
  await form.getByLabel('Số tiền VND').fill('25000');
  await form.getByLabel('Ghi chú tùy chọn').fill('Bữa trưa');
  await form.getByRole('button',{name:'Tạo danh mục'}).click();
  const categoryDialog=page.locator('#tx-category-dialog');
  await expect(categoryDialog.getByRole('radio')).toHaveCount(15);
  await expect(categoryDialog.getByRole('radio',{name:'Tìm kiếm',exact:true})).toHaveCount(0);
  await expect(categoryDialog.getByRole('radio',{name:'Y tế',exact:true})).toBeVisible();
  await expect(categoryDialog.getByLabel('Loại danh mục')).toHaveValue('expense');
  await expect(categoryDialog.getByLabel('Loại danh mục')).toBeDisabled();
  await categoryDialog.getByLabel('Tên danh mục').fill('Ăn uống');
  await categoryDialog.getByRole('button',{name:'Tạo danh mục'}).click();
  await expect(categoryDialog.getByRole('alert')).toContainText('đã được sử dụng');
  await categoryDialog.getByLabel('Tên danh mục').fill('Ăn cùng bạn bè');
  await categoryDialog.getByRole('radio',{name:'Cà phê',exact:true}).check();
  await categoryDialog.getByRole('button',{name:'Tạo danh mục'}).click();
  await expect(form.getByLabel('Danh mục').locator('option:checked')).toHaveText('Ăn cùng bạn bè');
  await expect(form.locator('[data-category-preview] use')).toHaveAttribute('href','/assets/category-icons.svg#coffee');
  await expect(form.getByLabel('Số tiền VND')).toHaveValue('25.000');
  await expect(form.getByLabel('Ghi chú tùy chọn')).toHaveValue('Bữa trưa');
  await form.getByRole('button',{name:'Lưu giao dịch'}).click();
  await expect(page.locator('#tx-items')).toContainText('Bữa trưa');
  await expect(page.locator('#tx-items')).toContainText('25.000');
  await expect(page.locator('#tx-items')).toContainText('Ăn cùng bạn bè');
  await page.reload();
  await expect(page.locator('#tx-items use')).toHaveAttribute('href','/assets/category-icons.svg#coffee');
  await page.goto('/dashboard');
  await expect(page.getByRole('heading',{name:'Tổng thu chi',exact:true})).toBeVisible();
  await expect(page.locator('#finance-stats .stat-card').last()).toContainText('25.000');
  await expect(page.locator('#cashflow-svg .stock-line')).toHaveCount(2);
  await expect(page.locator('#cashflow-reading')).toContainText('Chi 25.000');
  await page.goto('/transactions');
  await page.getByRole('button',{name:'Bộ lọc',exact:true}).click();
  await page.locator('#tx-filter-new-category').click();
  await expect(categoryDialog.getByLabel('Loại danh mục')).toBeEnabled();
  await categoryDialog.getByLabel('Loại danh mục').selectOption('income');
  await categoryDialog.getByLabel('Tên danh mục').fill('Thưởng dự án');
  await categoryDialog.getByRole('button',{name:'Tạo danh mục'}).click();
  await expect(page.locator('#tx-filter-category option:checked')).toHaveText('Thưởng dự án');
  await page.locator('#tx-filter-category').selectOption('');
  await page.getByRole('button',{name:'Bộ lọc',exact:true}).click();
  await page.getByLabel('Tìm trong ghi chú').fill('Bữa trưa');
  await page.getByRole('button',{name:'Áp dụng bộ lọc'}).click();
  await page.getByRole('button',{name:'Xem chi tiết'}).click();
  await expect(page.locator('#tx-detail-data')).toContainText('Lịch sử thay đổi');
  await page.getByRole('button',{name:'Sửa',exact:true}).click();
  await expect(form.getByLabel('Số tiền VND')).toHaveValue('25.000');
  await form.getByLabel('Ghi chú tùy chọn').fill('Bữa tối');
  await form.getByRole('button',{name:'Lưu giao dịch'}).click();
  await expect(page.locator('#tx-notice')).toContainText('nằm ngoài bộ lọc');
  await expect(page.getByLabel('Tìm trong ghi chú')).toHaveValue('Bữa trưa');
  await page.getByRole('button',{name:'Xóa bộ lọc'}).click();
  await page.getByRole('button',{name:'Xem chi tiết'}).click();
  await expect(page.locator('#tx-detail-data')).toContainText('Bữa trưa → Bữa tối');
  await page.getByRole('button',{name:'Xóa',exact:true}).click();
  await expect(page.locator('#tx-delete-description')).toContainText('Bữa tối');
  await expect(page.locator('#tx-delete-description')).toContainText('25.000');
  await page.getByRole('button',{name:'Xóa giao dịch',exact:true}).click();
  await expect(page.locator('#tx-notice')).toContainText('Đã xóa giao dịch');
  await page.getByLabel('Trạng thái').selectOption('1');
  await page.getByRole('button',{name:'Xem chi tiết'}).click();
  await expect(page.locator('#tx-detail-data')).toContainText('Đã xóa');
  await expect(page.locator('#tx-detail-data')).toContainText('Xóa ·');
  await page.getByRole('button',{name:'Đóng',exact:true}).click();
  for (const width of [320,390,1440]) {
    await page.setViewportSize({width,height:844});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  await page.goto('/wallets');
  await expect(page.locator('#wallet-items')).toContainText('Tiền mặt');
  await expect(page.locator('#wallet-assets')).toHaveText(/0/);
  await page.goto('/dashboard');
  await expect(page.locator('#cashflow-empty')).toBeVisible();
});

test('spending jars survive reload, recalculate progress, and update the open dashboard',async({page,context})=>{
  await page.setViewportSize({width:390,height:844});
  await signIn(page);
  const dashboard=await context.newPage();
  await dashboard.goto('/dashboard');
  await expect(dashboard.locator('#dashboard-goals-empty')).toBeVisible();
  await page.goto('/goals');
  await page.getByRole('button',{name:'Tạo hũ đầu tiên'}).click();
  const dialog=page.getByRole('dialog');
  await dialog.getByLabel('Tên hũ').fill('Du lịch');
  await dialog.getByLabel('Số tiền mục tiêu (VND)').fill('5000000');
  await dialog.getByLabel('Tháng',{exact:true}).selectOption('02');
  await dialog.getByLabel('Năm',{exact:true}).selectOption('2027');
  const day=dialog.getByLabel('Ngày',{exact:true});
  await expect(day.locator('option[value="29"]')).toBeDisabled();
  await dialog.getByRole('button',{name:'Lưu hũ chi tiêu'}).click();
  await expect(dialog.getByRole('alert')).toContainText('Chọn đủ ngày, tháng và năm');
  await dialog.getByLabel('Năm',{exact:true}).selectOption('2028');
  await day.selectOption('29');
  await dialog.getByLabel('Ghi chú (tùy chọn)').fill('Vé và chỗ ở');
  await dialog.getByRole('button',{name:'Lưu hũ chi tiêu'}).click();
  const card=page.locator('#goals-items > li');
  const percentage=card.locator('.goal-progress-title > span');
  const overview=dashboard.locator('#dashboard-goals');
  await expect(percentage).toHaveText('0%');
  await expect(card).toContainText('Hạn hoàn thành');
  await expect(overview).toContainText('Du lịch');
  await page.reload();
  await expect(card).toContainText('Vé và chỗ ở');
  await expect(percentage).toHaveText('0%');

  async function addSavings(amount,current,next) {
    await card.getByRole('button',{name:'Thêm tiền vào hũ'}).click();
    await expect(dialog.locator('#goal-saved-current')).toContainText(current);
    await dialog.getByLabel('Số tiền thêm (VND)').fill(amount);
    await expect(dialog.locator('#goal-saved-next')).toContainText(next);
    await dialog.getByRole('button',{name:'Thêm tiền',exact:true}).click();
    await expect(dialog).toBeHidden();
  }
  await addSavings('2000000','0','2.000.000');
  await expect(percentage).toHaveText('40%');
  await expect(card.locator('dl > div').filter({hasText:'Còn thiếu'})).toContainText('3.000.000');
  await expect(overview).toContainText('40%');
  await addSavings('3000000','2.000.000','5.000.000');
  await expect(card).toContainText('Đã hoàn thành');
  await expect(card.locator('progress')).toHaveAttribute('value','100');
  await addSavings('500000','5.000.000','5.500.000');
  await expect(percentage).toHaveText('110%');
  await expect(card.locator('progress')).toHaveAttribute('value','100');
  await card.getByRole('button',{name:'Sửa hũ'}).click();
  await expect(dialog.getByLabel('Ghi chú (tùy chọn)')).toHaveValue('Vé và chỗ ở');
  await expect(day).toHaveValue('29');
  await expect(dialog.getByLabel('Tháng',{exact:true})).toHaveValue('02');
  await expect(dialog.getByLabel('Năm',{exact:true})).toHaveValue('2028');
  await dialog.getByRole('button',{name:'Xóa ngày'}).click();
  await dialog.getByLabel('Tên hũ').fill('Du lịch hè');
  await dialog.getByLabel('Số tiền mục tiêu (VND)').fill('11000000');
  await dialog.getByRole('button',{name:'Lưu hũ chi tiêu'}).click();
  await expect(percentage).toHaveText('50%');
  await expect(card).not.toContainText('Hạn hoàn thành');
  await expect(card).not.toContainText('Đã hoàn thành');
  await expect(overview).toContainText('Du lịch hè');
  for (const width of [320,390,1440]) {
    await page.setViewportSize({width,height:844});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  await card.getByRole('button',{name:'Xóa hũ'}).click();
  await expect(dialog).toContainText('Du lịch hè');
  await dialog.getByRole('button',{name:'Xóa hũ',exact:true}).click();
  await expect(page.getByRole('button',{name:'Tạo hũ đầu tiên'})).toBeVisible();
  await expect(dashboard.locator('#dashboard-goals-empty')).toBeVisible();
  await page.reload();
  await expect(card).toHaveCount(0);
});

test('budget creation shows rollover on mobile, dashboard and reports',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await signIn(page);
  await page.goto('/budgets');
  await expect(page.locator('#budget-status')).toContainText('Chưa có ngân sách');
  const period=page.getByRole('group',{name:'Kỳ ngân sách'});
  const month=period.getByLabel('Tháng',{exact:true});
  const year=period.getByLabel('Năm',{exact:true});
  await expect(month.locator('option')).toHaveCount(12);
  const currentYear=await year.inputValue();
  const currentMonth=await month.inputValue();
  const current=`${currentYear}-${currentMonth}`;
  const previousDate=new Date(current+'-01T00:00:00Z');
  previousDate.setUTCMonth(previousDate.getUTCMonth()-1);
  const previous=previousDate.toISOString().slice(0,7);
  const [previousYear,previousMonth]=previous.split('-');
  const differentYear=String(Number(currentYear)-1);
  const renewedPeriod=page.waitForRequest(request=>request.url().endsWith(`?month=${differentYear}-${currentMonth}`));
  await year.selectOption(differentYear);
  await year.press('Tab');
  await renewedPeriod;
  await year.selectOption(previousYear);
  await year.press('Tab');
  await month.selectOption(previousMonth);
  const transactionStatus=await page.evaluate(async month=>{
    const headers={'Content-Type':'application/json','X-CSRF-Token':document.querySelector('meta[name=csrf-token]').content};
    await fetch('/api/transactions/options',{method:'POST',headers,body:JSON.stringify({resource:'starter'})});
    const options=await fetch('/api/transactions/options');
    const {wallets,categories}=(await options.json()).data;
    const response=await fetch('/api/transactions',{method:'POST',headers,body:JSON.stringify({
      walletId:wallets[0].id,categoryId:categories.find(category=>category.name==='Ăn uống').id,
      amount:'2400000',date:month+'-10',kind:'expense',
    })});
    return response.status;
  },previous);
  expect(transactionStatus).toBe(201);
  await page.getByRole('button',{name:'Tạo ngân sách',exact:true}).click();
  const dialog=page.getByRole('dialog');
  await dialog.getByLabel('Danh mục chi').selectOption({label:'Ăn uống'});
  await dialog.getByLabel('Hạn mức gốc (VND)').fill('3000000');
  await expect(dialog.getByLabel('Tháng bắt đầu')).toHaveValue(previous.slice(5)+'/'+previous.slice(2,4));
  await dialog.getByRole('checkbox',{name:'Tự động gia hạn'}).check();
  await dialog.getByRole('button',{name:'Lưu ngân sách'}).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('#budget-items')).toContainText('Sắp hết ngân sách');
  await expect(page.locator('#budget-total-remaining')).toContainText('600.000');
  await year.selectOption(currentYear);
  await year.press('Tab');
  await month.selectOption(currentMonth);
  await expect(page.locator('#budget-total-available')).toContainText('3.600.000');
  await expect(page.locator('#budget-items')).toContainText('600.000');
  for(const width of [320,390,1440]) {
    await page.setViewportSize({width,height:844});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  await page.goto('/dashboard');
  await expect(page.locator('#dashboard-budget-items')).toContainText('3.600.000');
  await page.goto('/reports');
  await expect(page.locator('#report-budget-items')).toContainText('3.600.000');
});

test('wallet controls reconcile cash, card debt and filtered history on mobile and dashboard',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await signIn(page);
  await page.goto('/wallets');
  await expect(page.locator('#wallet-net')).toBeVisible();
  const readWallets=()=>page.evaluate(async()=> (await (await fetch('/api/wallets')).json()).data);
  const baseline=(await readWallets()).totals;
  const amount=value=>Number(value).toLocaleString('vi-VN');
  const dialog=page.getByRole('dialog');
  async function create(name,kind,opening,limit) {
    await page.getByRole('button',{name:'Thêm ví',exact:true}).click();
    await dialog.getByLabel('Tên ví').fill(name);
    await dialog.getByLabel('Loại ví').selectOption(kind);
    await dialog.getByLabel(kind==='credit' ? 'Dư nợ ban đầu (VND)' : 'Số dư ban đầu (VND)').fill(opening);
    if (limit) await dialog.getByLabel('Hạn mức tín dụng (VND)').fill(limit);
    await dialog.getByRole('button',{name:'Lưu ví'}).click();
    await expect(page.locator('#wallet-items').getByRole('heading',{name,exact:true})).toBeVisible();
  }
  await create('Tiền túi','cash','1000000');
  await create('Ngân hàng','bank','100000');
  await create('Thẻ du lịch','credit','300000','1000000');
  const {items}=await readWallets();
  const ids=Object.fromEntries(items.map(item=>[item.name,item.id]));
  const card=name=>page.locator('#wallet-items li').filter({has:page.getByRole('heading',{name,exact:true})});
  await card('Tiền túi').getByRole('button',{name:'Sửa ví'}).click();
  await dialog.getByLabel('Ghi chú (tùy chọn)').fill('Đã đối chiếu');
  await dialog.getByRole('button',{name:'Lưu ví'}).click();
  await expect(card('Tiền túi')).toContainText('Đã đối chiếu');
  await card('Tiền túi').getByRole('button',{name:'Điều chỉnh số dư'}).click();
  await dialog.getByLabel('Số dư thực tế (VND)').fill('950000');
  await dialog.getByLabel('Lý do điều chỉnh').fill('Đếm lại tiền');
  await dialog.getByRole('button',{name:'Lưu điều chỉnh'}).click();
  await expect(card('Tiền túi')).toContainText('950.000');
  await page.getByRole('button',{name:'Chuyển tiền giữa ví'}).click();
  await dialog.getByLabel('Ví nguồn').selectOption(ids['Tiền túi']);
  await dialog.getByLabel('Ví đích').selectOption(ids['Ngân hàng']);
  await dialog.getByLabel('Số tiền (VND)').fill('200000');
  await dialog.getByRole('button',{name:'Xác nhận'}).click();
  await expect(card('Tiền túi')).toContainText('750.000');
  await page.getByRole('button',{name:'Thanh toán thẻ',exact:true}).click();
  await dialog.getByLabel('Ví thanh toán').selectOption(ids['Ngân hàng']);
  await dialog.getByLabel('Thẻ cần trả nợ').selectOption(ids['Thẻ du lịch']);
  await dialog.getByLabel('Số tiền (VND)').fill('150000');
  await dialog.getByRole('button',{name:'Xác nhận'}).click();
  await expect(card('Thẻ du lịch')).toContainText('850.000');
  await expect(page.locator('#wallet-net')).toContainText(amount(Number(baseline.net)+750000));
  await card('Ngân hàng').getByRole('button',{name:'Xem lịch sử'}).click();
  await dialog.getByLabel('Loại biến động').selectOption('payment');
  await dialog.getByRole('button',{name:'Áp dụng'}).click();
  await expect(dialog.locator('#wallet-history-items > li')).toHaveCount(1);
  await expect(dialog.locator('#wallet-history-items')).toContainText('Thanh toán thẻ');
  await expect(dialog.locator('#wallet-history-opening')).toContainText('100.000');
  await expect(dialog.locator('#wallet-history-closing')).toContainText('150.000');
  await expect(dialog.locator('polyline')).toHaveAttribute('points',/,/);
  for (const width of [320,390,1440]) {
    await page.setViewportSize({width,height:844});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    expect(await dialog.evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
  }
  await dialog.getByRole('button',{name:'Đóng'}).click();
  await page.goto('/dashboard');
  await expect(page.locator('#finance-stats .stat-card').first()).toContainText(amount(Number(baseline.net)+750000));
  await page.goto('/reports');
  await expect(page.locator('#report-wallet-items')).toContainText(amount(Number(baseline.net)+750000));
  await expect(page.locator('#report-wallet-items')).toContainText('Dư nợ');
  await expect(page.locator('[data-finance-items] li').nth(1)).toContainText('0');
});

test('reports show category shares and four chronological expense bars with touch and keyboard choices',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await signIn(page);
  await page.goto('/reports');
  await expect(page.locator('#report-as-of')).toContainText('Tính đến hôm nay');
  const responses=await page.evaluate(async()=>{
    const headers={'Content-Type':'application/json','X-CSRF-Token':document.querySelector('meta[name=csrf-token]').content};
    await fetch('/api/transactions/options',{method:'POST',headers,body:JSON.stringify({resource:'starter'})});
    const {wallets,categories}=(await (await fetch('/api/transactions/options')).json()).data;
    const rows=[['2024-10-05','4000000','Ăn uống'],['2024-11-05','5000000','Ăn uống'],['2024-12-05','6000000','Ăn uống'],['2025-01-05','2400000','Ăn uống'],['2025-01-06','3600000','Đi lại']];
    const statuses=[];
    for (const [date,amount,name] of rows) {
      const body={date,amount,kind:'expense',walletId:wallets[0].id,categoryId:categories.find(category=>category.name===name).id};
      statuses.push((await fetch('/api/transactions',{method:'POST',headers,body:JSON.stringify(body)})).status);
    }
    return statuses;
  });
  expect(responses).toEqual([201,201,201,201,201]);
  const period=page.getByRole('group',{name:'Kỳ báo cáo'});
  const year=period.getByLabel('Năm',{exact:true}), month=period.getByLabel('Tháng',{exact:true});
  await year.selectOption('2025');
  await year.press('Tab');
  await month.selectOption('01');
  await expect(page.locator('#report-total-expense')).toContainText('6.000.000');
  await expect(page.locator('#report-as-of')).toBeHidden();
  await expect(page.locator('#report-donut .report-segment')).toHaveCount(2);
  await expect(page.locator('#report-category-list li').first()).toContainText('Đi lại');
  const food=page.getByRole('button',{name:/Ăn uống.*40%/});
  await food.press('Enter');
  await expect(page.locator('#report-category-reading')).toContainText(/Ăn uống.*2\.400\.000.*40%/);
  await expect(page.locator('#report-month-list button > span')).toHaveText(['10/24','11/24','12/24','01/25']);
  await page.locator('#report-trend .report-bar-hit').first().click();
  await expect(page.locator('#report-month-reading')).toContainText(/10\/24.*4\.000\.000/);
  await page.getByLabel('Mốc so sánh').selectOption('average');
  await expect(page.locator('#report-trend .report-benchmark')).toHaveCount(1);
  await expect(page.locator('#report-change')).toContainText(/Tăng 1\.000\.000.*\+20%/);
  for (const width of [320,390,1440]) {
    await page.setViewportSize({width,height:844});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  await month.selectOption('03');
  await expect(page.getByText('Chưa có chi tiêu trong tháng này',{exact:true})).toBeVisible();
  await page.getByLabel('Mốc so sánh').selectOption('previous');
  await expect(page.locator('#report-change')).toContainText('—');
});

test('settings edit categories and profile, apply money and cycle preferences, export and reset',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await signIn(page);
  await page.goto('/settings');
  await expect(page.getByRole('heading',{name:'Danh mục Thu/Chi'})).toBeVisible();
  const base=page.locator('#settings-expense li').filter({hasText:'Ăn uống'});
  await expect(base).toContainText('Mặc định');
  await base.getByRole('button',{name:'Sửa',exact:true}).click();
  const dialog=page.getByRole('dialog');
  await dialog.getByLabel('Tên danh mục').fill('Ăn uống hằng ngày');
  await dialog.getByLabel('Biểu tượng').selectOption('coffee');
  await dialog.getByLabel('Dùng màu mặc định').uncheck();
  await dialog.getByLabel('Màu danh mục').fill('#123456');
  await dialog.getByRole('button',{name:'Lưu danh mục'}).click();
  await expect(base).toContainText('Ăn uống hằng ngày');
  await base.getByRole('button',{name:'Ẩn',exact:true}).click();
  await expect(base).toContainText('Đã ẩn');
  await page.getByRole('button',{name:'Thêm danh mục',exact:true}).click();
  await dialog.getByLabel('Tên danh mục').fill('Mua đồ riêng');
  await dialog.getByRole('button',{name:'Lưu danh mục'}).click();
  await expect(page.locator('#settings-expense')).toContainText('Mua đồ riêng');

  await page.getByLabel('Định dạng số').selectOption('commas');
  await expect(page.locator('#settings-number-preview')).toContainText('1,234,567');
  await page.getByLabel('Ngày bắt đầu chu kỳ tháng').selectOption('31');
  await page.getByRole('button',{name:'Lưu tùy chọn'}).click();
  await expect(page.getByText('Đã lưu tùy chọn.',{exact:true})).toBeVisible();
  await page.getByLabel('Quê quán / tỉnh thành').fill('Huế');
  await page.getByRole('button',{name:'Lưu hồ sơ'}).click();
  await expect(page.getByText('Đã lưu hồ sơ.',{exact:true})).toBeVisible();
  const downloaded=page.waitForEvent('download');
  await page.getByRole('link',{name:'Tải bản sao JSON'}).click();
  expect((await downloaded).suggestedFilename()).toMatch(/la-sao-luu-.*\.json/);

  await page.goto('/reports');
  const reportPeriod=page.getByRole('group',{name:'Kỳ báo cáo'});
  await expect(page.locator('#report-range')).toBeVisible();
  await reportPeriod.getByLabel('Năm',{exact:true}).selectOption('2024');
  await reportPeriod.getByLabel('Năm',{exact:true}).press('Tab');
  await reportPeriod.getByLabel('Tháng',{exact:true}).selectOption('12');
  await expect(page.locator('#report-total-expense')).toContainText('6,000,000');
  await reportPeriod.getByLabel('Năm',{exact:true}).selectOption('2025');
  await reportPeriod.getByLabel('Năm',{exact:true}).press('Tab');
  await reportPeriod.getByLabel('Tháng',{exact:true}).selectOption('01');
  await expect(page.locator('#report-range')).toContainText('31/01/25');
  await page.goto('/transactions');
  await page.getByRole('button',{name:'Bộ lọc',exact:true}).click();
  await expect(page.locator('#tx-filter-category option')).toContainText(['Ăn uống hằng ngày (đã ẩn)']);
  await page.getByLabel('Dùng kỳ tài chính hiện tại').check();
  await expect(page.getByLabel('Từ ngày')).toBeDisabled();
  await page.locator('#tx-apply-advanced').click();
  await expect(page.locator('#tx-cycle-note')).toContainText('Kỳ tài chính');
  await page.getByRole('button',{name:'Thêm giao dịch',exact:true}).click();
  await expect(page.locator('#tx-form select[name="categoryId"] option').filter({hasText:'Ăn uống hằng ngày'})).toHaveCount(0);

  await page.goto('/settings');
  await expect(page.getByLabel('Định dạng số')).toHaveValue('commas');
  await page.getByRole('button',{name:'Khôi phục mặc định',exact:true}).click();
  await dialog.getByRole('button',{name:'Xác nhận khôi phục'}).click();
  await expect(page.getByLabel('Định dạng số')).toHaveValue('dots');
  await expect(page.getByLabel('Ngày bắt đầu chu kỳ tháng')).toHaveValue('1');
  await expect(base).toContainText('Ăn uống');
  await expect(base).not.toContainText('Đã ẩn');
  await expect(page.locator('#settings-expense')).toContainText('Mua đồ riêng');
  await expect(page.getByLabel('Quê quán / tỉnh thành')).toHaveValue('Huế');
  for (const width of [320,390,1440]) {
    await page.setViewportSize({width,height:844});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
});
