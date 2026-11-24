import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,createClient,register,account} from '../support/fixture.mjs';
import {randomUUID} from 'node:crypto';
import {financePeriodEnd,localFinanceDate} from '../../shared/transaction-policy.mjs';

const api = '/api/transactions';
async function expectData(response,status=200) {
  const result=await response.json();
  assert.equal(response.status,status,JSON.stringify(result));
  return result.data;
}
async function profile(f,client,credentials=account) {
  await client.init();
  assert.equal((await register(client,credentials)).status,201);
  const [user]=await f.db.execute('SELECT id FROM users WHERE email=?',[credentials.email]);
  await f.db.call('la_onboarding_save_profile',[user.id,'Test Ledger','2000-01-01','Hà Nội','0','save_money',null]);
  await f.db.execute('UPDATE users SET email_verified_at=UTC_TIMESTAMP(6) WHERE id=?',[user.id]);
  await f.db.call('la_onboarding_complete',[user.id]);
  assert.equal((await client.post('/api/auth/login',{type:'email',identifier:credentials.email,password:credentials.password})).status,200);
  await expectData(await client.post(api+'/options',{resource:'starter'}),201);
  const options=await expectData(await client.get(api+'/options'));
  return {userId:user.id,wallet:options.wallets[0].id,income:options.categories.find(c=>c.kind==='income').id,expense:options.categories.find(c=>c.kind==='expense').id};
}
const summary = async (client,month) => expectData(await client.get('/api/finance/summary?month='+month));
const create = async (client,body) => expectData(await client.post(api,body),201);

test('ledger updates wallet and both months after edit, and preserves history after delete',async t=>{
  const f=await setup(t), client=f.client;
  const ids=await profile(f,client);
  const coffee=await expectData(await client.post(api+'/options',{resource:'category',name:'Cà phê cuối tuần',kind:'expense',icon:'coffee'}),201);
  assert.equal(coffee.icon,'coffee');
  assert.equal((await client.post(api+'/options',{resource:'category',name:'Icon lạ',kind:'expense',icon:'missing'})).status,400);
  await expectData(await client.post(api+'/options',{resource:'wallet',name:'Ngân hàng'}),201);
  const second=(await expectData(await client.get(api+'/options'))).wallets.find(wallet=>wallet.name==='Ngân hàng').id;
  const common={walletId:ids.wallet,date:'2026-11-10'};
  const income=await create(client,{...common,kind:'income',categoryId:ids.income,amount:'9007199254740993',note:'Lương'});
  const expense=await create(client,{...common,kind:'expense',categoryId:coffee.id,amount:'50000',note:'Mua đồ'});
  assert.equal(expense.categoryIcon,'coffee');
  assert.equal(income.amount,'9007199254740993');
  let nov=await summary(client,'2026-11');
  assert.deepEqual(nov.daily,[{date:'2026-11-10',income:'9007199254740993',expense:'50000'}]);
  assert.equal(nov.balance,'9007199254690993');
  assert.equal(nov.spending.find(c=>c.id===coffee.id).spent,'50000');
  const edited=await expectData(await client.put(api+'/'+expense.id,{
    ...common,kind:'income',categoryId:ids.income,walletId:second,date:'2026-12-10',amount:'70000',revision:expense.revision,
  }));
  assert.equal((await client.put(api+'/'+expense.id,{...common,kind:'expense',categoryId:ids.expense,amount:'1',revision:expense.revision})).status,409);
  nov=await summary(client,'2026-11');
  const dec=await summary(client,'2026-12');
  assert.equal(nov.totals.expense,'0');
  assert.equal(nov.spending.find(c=>c.id===coffee.id).spent,'0');
  assert.equal(dec.totals.income,'70000');
  assert.deepEqual(dec.daily,[{date:'2026-12-10',income:'70000',expense:'0'}]);
  assert.equal(dec.wallets.find(w=>w.id===second).balance,'70000');
  assert.equal(dec.wallets.find(w=>w.id===ids.wallet).balance,'9007199254740993');
  await expectData(await client.delete(api+'/'+expense.id,{revision:edited.revision}));
  assert.equal((await summary(client,'2026-12')).totals.income,'0');
  assert.deepEqual((await summary(client,'2026-12')).daily,[]);
  assert.equal((await summary(client,'2026-12')).wallets.find(w=>w.id===second).balance,'0');
  const history=await expectData(await client.get(api+'/'+expense.id+'/history'));
  assert.deepEqual(history.map(h=>h.action),['delete','update','create']);
  assert.equal(history[1].beforeState.walletId,ids.wallet);
  assert.equal(history[1].afterState.walletId,second);
  assert.ok((await expectData(await client.get(api+'/'+expense.id))).deletedAt);
  assert.deepEqual((await expectData(await client.get(api+'?deleted=1'))).items.map(item=>item.id),[expense.id]);
});

test('combines all filters, sorts before pagination and reads do not change the ledger',async t=>{
  const f=await setup(t), client=f.client;
  const ids=await profile(f,client);
  const make=(amount,note='Mẫu chung',date='2026-11-10')=>create(client,{walletId:ids.wallet,kind:'expense',categoryId:ids.expense,amount:String(amount),note,date});
  for(let index=17;index>=1;index--) await make(index);
  const outside=await make(9,'Khác','2026-12-10');
  const path=api+'?from=2026-11-01&to=2026-11-30&kind=expense&walletId='+ids.wallet+'&categoryId='+ids.expense+'&min=1&max=17&q='+encodeURIComponent('Mẫu chung');
  const before=await summary(client,'2026-11');
  const first=await expectData(await client.get(path+'&sort=amountAsc&matchId='+outside.id));
  const second=await expectData(await client.get(path+'&sort=amountAsc&page=2'));
  assert.equal(first.total,17);
  assert.equal(first.matchesFilter,false);
  assert.deepEqual(first.items.map(tx=>Number(tx.amount)),Array.from({length:15},(_,i)=>i+1));
  assert.deepEqual(second.items.map(tx=>tx.amount),['16','17']);
  assert.equal((await expectData(await client.get(path+'&sort=amountDesc'))).items[0].amount,'17');
  assert.deepEqual(await summary(client,'2026-11'),before);
});

test('rejects foreign ownership and rolls back writes when audit cannot be saved',async t=>{
  const f=await setup(t), first=f.client;
  const owner=await profile(f,first);
  const other=createClient(f.base);
  const foreign=await profile(f,other,{...account,email:'other-ledger@example.test',phone:'0971234567'});
  const goal=await expectData(await first.post('/api/goals',{name:'Dự phòng',targetAmount:'1000000',savedAmount:'0'}),201);
  assert.equal((await other.put('/api/goals/'+goal.id,{name:'Đổi tên',targetAmount:'1000',savedAmount:'1'})).status,404);
  assert.deepEqual(await expectData(await other.get('/api/goals')),[]);
  assert.equal((await first.put('/api/goals/'+goal.id,{name:'Dự phòng',targetAmount:'0',savedAmount:'1'})).status,400);
  const saved=await expectData(await first.put('/api/goals/'+goal.id,{name:'Dự phòng',targetAmount:'1000000',savedAmount:'500000'}));
  assert.equal(saved.savedAmount,'500000');
  assert.equal((await summary(first,'2026-11')).goals[0].savedAmount,'500000');
  const body={kind:'expense',walletId:owner.wallet,categoryId:owner.expense,amount:'1234',date:'2026-11-09',note:'Test'};
  const item=await create(first,body);
  assert.equal((await other.get(api+'/'+item.id)).status,404);
  assert.equal((await other.get(api+'/'+item.id+'/history')).status,404);
  assert.equal((await other.put(api+'/'+item.id,{...body,walletId:foreign.wallet,categoryId:foreign.expense})).status,404);
  assert.equal((await other.delete(api+'/'+item.id,{})).status,404);
  assert.equal((await first.post(api,{...body,walletId:foreign.wallet,categoryId:foreign.expense})).status,400);
  assert.equal((await first.post(api,{...body,amount:1})).status,400);
  await f.db.execute("CREATE TRIGGER fail_finance_history BEFORE INSERT ON finance_transaction_history FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='AUDIT_WRITE_TEST'");
  assert.equal((await first.post(api,body)).status,503);
  assert.equal((await first.put(api+'/'+item.id,{...body,amount:'99'})).status,503);
  assert.equal((await first.delete(api+'/'+item.id,{})).status,503);
  const list=await expectData(await first.get(api));
  assert.equal(list.total,1);
  assert.equal(list.items[0].amount,'1234');
  assert.equal((await expectData(await first.get(api+'/'+item.id+'/history'))).length,1);
  assert.equal((await summary(first,'2026-11')).balance,'-1234');
});

test('spending jars keep precise manual savings, scope every operation to the owner and archive on delete',async t=>{
  const f=await setup(t), owner=f.client;
  await profile(f,owner);
  const other=createClient(f.base);
  await profile(f,other,{...account,email:'other-goals@example.test',phone:'0971234567'});
  const api='/api/goals';
  const jar={name:'  Du lịch  ',targetAmount:'5000000',dueDate:'2028-02-29',note:'  Vé và chỗ ở  '};
  for (const invalid of [{name:' '},{targetAmount:'0'},{dueDate:'2027-02-29'},{note:'X'.repeat(501)},{savedAmount:'1'}]) {
    assert.equal((await owner.post(api,{...jar,...invalid})).status,400);
  }
  const created=await expectData(await owner.post(api,jar),201);
  assert.deepEqual(created,{id:created.id,...jar,name:'Du lịch',note:'Vé và chỗ ở',savedAmount:'0'});
  const url=api+'/'+created.id;
  assert.deepEqual(await expectData(await owner.get(url)),created);
  assert.equal((await other.get(url)).status,404);
  assert.equal((await other.put(url+'/savings',{savedAmount:'23'})).status,404);
  assert.equal((await other.post(url+'/savings',{amount:'23'})).status,404);
  assert.equal((await other.delete(url,{})).status,404);
  assert.equal((await owner.put(url+'/savings',{savedAmount:'-1'})).status,400);
  for (const amount of ['0','-1','1.5']) assert.equal((await owner.post(url+'/savings',{amount})).status,400);
  await Promise.all(['9007199254740990','3'].map(amount=>owner.post(url+'/savings',{amount}).then(response=>expectData(response))));
  assert.equal((await owner.post(url+'/savings',{amount:'999999999999999999'})).status,400);
  const saved=await expectData(await owner.get(url));
  assert.equal(saved.savedAmount,'9007199254740993');
  const edited=await expectData(await owner.put(url,{name:'Du lịch hè',targetAmount:'9007199254740994',dueDate:null,note:''}));
  assert.equal(edited.savedAmount,saved.savedAmount);
  assert.equal(edited.dueDate,null);
  assert.equal(edited.note,null);
  assert.deepEqual(await expectData(await owner.get(api)),[edited]);
  assert.deepEqual((await summary(owner,'2026-11')).goals,[edited]);
  assert.equal((await summary(owner,'2026-11')).balance,'0');
  await expectData(await owner.delete(url,{}));
  assert.equal((await owner.get(url)).status,404);
  assert.deepEqual(await expectData(await owner.get(api)),[]);
  assert.deepEqual((await summary(owner,'2026-11')).goals,[]);
  const [archived]=await f.db.execute('SELECT deleted_at,saved_amount FROM finance_goals WHERE id=?',[created.id]);
  assert.ok(archived.deleted_at);
  assert.equal(archived.saved_amount,saved.savedAmount);
});

test('wallets reconcile transactions, adjustments, transfer and credit payments in one ledger',async t=>{
  const f=await setup(t), client=f.client, ids=await profile(f,client);
  const api='/api/wallets';
  const wallet=(name,kind,openingAmount,extra={})=>client.post(api,{name,kind,openingAmount,...extra}).then(response=>expectData(response,201));
  const cash=await wallet('Tiền túi','cash','1000000');
  const bank=await wallet('Ngân hàng','bank','200000');
  const ewallet=await wallet('Ví điện tử','ewallet','0');
  const card=await wallet('Thẻ','credit','100000',{creditLimit:'1000000',paymentDue:'2028-12-01'});
  const today=localFinanceDate(), previous=new Date(today+'T00:00:00Z');
  previous.setUTCDate(previous.getUTCDate()-1);
  const yesterday=previous.toISOString().slice(0,10);
  const buy={walletId:cash.id,categoryId:ids.expense,kind:'expense',amount:'50000',date:yesterday};
  const original=await create(client,buy);
  await expectData(await client.put('/api/transactions/'+original.id,{...buy,walletId:bank.id,revision:original.revision}));
  await create(client,{...buy,walletId:card.id,amount:'300000',date:yesterday});
  const adjust=(id,expectedBalance,actual)=>client.post(`${api}/${id}/adjustments`,{expectedBalance,actual,reason:'Đối chiếu'});
  const history=(id,kind='')=>client.get(`${api}/${id}/history?from=${today}&to=${today}&kind=${kind}`).then(response=>expectData(response));
  assert.equal((await expectData(await adjust(cash.id,'1000000','950000'))).delta,'-50000');
  assert.equal((await adjust(cash.id,'1000000','980000')).status,409);
  assert.equal((await expectData(await adjust(cash.id,'950000','980000'))).delta,'30000');
  assert.equal((await client.put(`${api}/${cash.id}/archive`,{archived:true})).status,409);
  const transfer={sourceId:cash.id,destinationId:bank.id,amount:'100000',note:'Để riêng',requestId:randomUUID()};
  const move=(kind,data)=>client.post(`${api}/operations/${kind}`,data);
  assert.equal((await move('transfer',{...transfer,amount:'1000000',requestId:randomUUID()})).status,409);
  const requests=await Promise.all([move('transfer',transfer),move('transfer',transfer)]);
  assert.deepEqual(requests.map(response=>response.status).sort(),[200,201]);
  assert.equal((await move('transfer',{...transfer,amount:'100001'})).status,409);
  const payment={sourceId:bank.id,destinationId:card.id,amount:'150000',requestId:randomUUID()};
  assert.equal((await move('payment',{...payment,sourceId:cash.id,amount:'400001'})).status,409);
  await expectData(await move('payment',payment),201);
  await expectData(await move('payment',payment));
  const listed=await expectData(await client.get(api));
  assert.deepEqual(listed.totals,{assets:'980000',debt:'250000',net:'730000'});
  assert.equal(listed.items.find(item=>item.id===card.id).creditAvailable,'750000');
  const bankHistory=await history(bank.id,'payment');
  assert.equal(bankHistory.opening,'150000');
  assert.equal(bankHistory.closing,'100000');
  assert.deepEqual(bankHistory.items.map(({kind,delta,balance})=>({kind,delta,balance})),[{kind:'payment',delta:'-150000',balance:'100000'}]);
  const cashHistory=await history(cash.id);
  assert.deepEqual(cashHistory.items.map(item=>item.delta),['-100000','30000','-50000']);
  assert.equal((await history(card.id)).opening,'400000');
  await expectData(await adjust(ewallet.id,'0','10'));
  await expectData(await adjust(ewallet.id,'10','0'));
  await expectData(await client.put(`${api}/${ewallet.id}/archive`,{archived:true}));
  assert.equal((await history(ewallet.id)).items.length,2);
  const choices=await expectData(await client.get('/api/transactions/options'));
  assert.equal(choices.wallets.some(item=>item.id===ewallet.id),false);
  assert.equal((await client.post('/api/transactions',{...buy,walletId:ewallet.id})).status,400);
  await expectData(await client.put(`${api}/${ewallet.id}/archive`,{archived:false}));
  assert.equal((await expectData(await client.get('/api/transactions/options'))).wallets.some(item=>item.id===ewallet.id),true);

  const other=createClient(f.base);
  await profile(f,other,{...account,email:'other-wallet@example.test',phone:'0971234567'});
  assert.equal((await other.get(`${api}/${cash.id}/history`)).status,404);
  assert.equal((await other.post(`${api}/${cash.id}/adjustments`,{actual:'0',expectedBalance:'880000',reason:'Đối chiếu'})).status,404);
  await f.db.execute(`CREATE TRIGGER fail_second_wallet_leg BEFORE INSERT ON finance_wallet_movements FOR EACH ROW
    BEGIN IF NEW.kind='transfer' AND NEW.delta>0 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='WALLET_LEG_TEST'; END IF; END`);
  const failure={...transfer,requestId:randomUUID()};
  assert.equal((await move('transfer',failure)).status,503);
  assert.equal((await f.db.execute('SELECT COUNT(*) AS count FROM finance_wallet_movements WHERE operation_key=?',[failure.requestId]))[0].count,'0');
  assert.equal((await history(cash.id)).closing,'880000');
  assert.equal((await history(bank.id)).closing,'100000');
  const reports=await summary(client,yesterday.slice(0,7));
  assert.equal(reports.totals.expense,'350000');
  assert.equal(reports.totals.income,'0');
  assert.deepEqual(reports.walletTotals,listed.totals);
  const currentReport=await expectData(await client.get('/api/reports'));
  assert.equal(currentReport.totals.expense,today.slice(0,7)===yesterday.slice(0,7) ? '350000' : '0');
  assert.equal(currentReport.totals.income,'0');
});

test('reports group expense sources, compare exact amounts across years and refresh both months after a move',async t=>{
  const f=await setup(t), client=f.client, ids=await profile(f,client);
  const category=await expectData(await client.post(api+'/options',{resource:'category',name:'Mua sắm',kind:'expense'}),201);
  const spend=(date,amount,categoryId=ids.expense)=>create(client,{date,amount,categoryId,kind:'expense',walletId:ids.wallet});
  for (const [date,amount] of [['2024-10-05','4000000'],['2024-11-05','5000000'],['2024-12-05','6000000']]) await spend(date,amount);
  const food=await spend('2025-01-06','2400000');
  await spend('2025-01-08','3100000',category.id);
  const deleted=await spend('2025-01-09','1000');
  await expectData(await client.delete(api+'/'+deleted.id,{revision:deleted.revision}));
  await create(client,{date:'2025-01-15',amount:'5000000',categoryId:ids.income,kind:'income',walletId:ids.wallet});
  // Recreate an orphaned category reference found in a legacy import.
  await f.db.transaction(async tx=>{
    await tx.execute('SET SESSION foreign_key_checks=0');
    try {
      await tx.execute(`INSERT INTO finance_transactions(user_id,kind,amount,wallet_id,category_id,transaction_date)
        VALUES (?,'expense',500000,?,999999,'2025-01-20')`,[ids.userId,ids.wallet]);
    } finally { await tx.execute('SET SESSION foreign_key_checks=1'); }
  });
  const report=month=>client.get('/api/reports?month='+month).then(response=>expectData(response));
  const january=await report('2025-01');
  assert.equal(january.totals.expense,'6000000');
  assert.deepEqual(january.report.categories.map(({name,spent,percent})=>[name,spent,percent]),[
    ['Mua sắm','3100000','51.67'],['Ăn uống','2400000','40'],['Chưa phân loại','500000','8.33'],
  ]);
  assert.deepEqual(january.report.series.map(item=>[item.month,item.spent]),[
    ['2024-10','4000000'],['2024-11','5000000'],['2024-12','6000000'],['2025-01','6000000'],
  ]);
  assert.deepEqual(january.report.comparisons.average,{reference:'5000000',difference:'1000000',direction:'up',percent:'20'});
  assert.deepEqual(january.report.comparisons.previous,{reference:'6000000',difference:'0',direction:'same',percent:'0'});
  const empty=await report('2024-09');
  assert.deepEqual(empty.report.categories,[]);
  assert.equal(empty.report.asOf,null);
  assert.ok(empty.report.series.every(item=>item.spent==='0'));
  const october=await report('2024-10');
  assert.deepEqual(october.report.comparisons.previous,{reference:'0',difference:'4000000',direction:'up',percent:null});
  const rows=await expectData(await client.get(api+'?from=2025-01-01&to=2025-01-31&kind=expense'));
  assert.equal(rows.items.reduce((sum,item)=>sum+BigInt(item.amount),0n).toString(),january.totals.expense);
  assert.equal(rows.items.find(item=>item.category==='Chưa phân loại').amount,'500000');
  await expectData(await client.put(api+'/'+food.id,{...food,date:'2025-02-06',categoryId:category.id}));
  assert.equal((await report('2025-01')).totals.expense,'3600000');
  const february=await report('2025-02');
  assert.deepEqual(february.report.categories.map(item=>[item.id,item.spent,item.percent]),[[category.id,'2400000','100']]);
  assert.deepEqual(february.report.comparisons.previous,{reference:'3600000',difference:'-1200000',direction:'down',percent:'-33.33'});

  const today=localFinanceDate(), month=today.slice(0,7);
  await spend(today,'100');
  const finalDay=financePeriodEnd(month,'');
  if (today<finalDay) await spend(finalDay,'200');
  await expectData(await client.post('/api/budgets',{month,categoryId:ids.expense,baseAmount:'300'}),201);
  const current=await report(month);
  assert.equal(current.report.asOf,today);
  assert.equal(current.totals.expense,'100');
  assert.equal(current.periods.find(entry=>entry.month===month).expense,'100');
  assert.equal((await summary(client,month)).totals.expense,'100');
  assert.equal(current.budgets.totals.spent,'100');
});

test('settings keep category links and account data and apply day 31 to report and transaction periods',async t=>{
  const f=await setup(t), client=f.client, ids=await profile(f,client);
  const other=createClient(f.base);
  await profile(f,other,{...account,email:'other-settings@example.test',phone:'0971234544'});
  const path='/api/settings';
  const state=()=>client.get(path).then(response=>expectData(response));
  const custom=await expectData(await client.post(path+'/categories',{kind:'expense',name:'Đi chợ riêng',icon:'groceries',color:'#335577'}),201);
  assert.equal((await client.post(path+'/categories',{kind:'expense',name:'   '})).status,400);
  assert.equal((await client.post(path+'/categories',{kind:'expense',name:custom.name})).status,409);
  await expectData(await client.post(path+'/categories',{kind:'income',name:custom.name}),201);
  const food=(await state()).categories.find(item=>item.name==='Ăn uống');
  assert.equal(food.defaultKey,'food');
  const transaction={walletId:ids.wallet,categoryId:food.id,kind:'expense'};
  const first=await create(client,{...transaction,date:'2025-02-27',amount:'10'});
  const boundary=await create(client,{...transaction,date:'2025-02-28',amount:'20'});
  await create(client,{...transaction,date:'2025-03-30',amount:'30'});
  await create(client,{...transaction,date:'2025-03-31',amount:'40'});
  await expectData(await client.post('/api/budgets',{categoryId:food.id,month:'2025-02',baseAmount:'1000'}),201);
  const customized={name:'Ăn uống hằng ngày',icon:'coffee',color:'#123456',hidden:true};
  assert.equal((await other.put(path+'/categories/'+food.id,customized)).status,404);
  const edited=await expectData(await client.put(path+'/categories/'+food.id,customized));
  assert.equal(edited.id,food.id);
  assert.ok(edited.hiddenAt);
  assert.equal((await client.post(api,{...transaction,date:'2025-03-01',amount:'10'})).status,400);
  await expectData(await client.put(api+'/'+first.id,{...first,note:'Giữ danh mục đã ẩn'}));
  const [bankFood]=(await expectData(await other.get(path))).categories.filter(item=>item.defaultKey==='food');
  assert.equal(bankFood.name,'Ăn uống');
  assert.equal((await expectData(await client.get(api+'/'+boundary.id))).categoryColor,'#123456');
  const budget=await expectData(await client.get('/api/budgets?month=2025-02'));
  assert.equal(budget.items[0].category,'Ăn uống hằng ngày');
  assert.equal(budget.items[0].spent,'30');
  assert.deepEqual((await state()).preferences,{currency:'VND',numberStyle:'dots',cycleStartDay:1});
  assert.equal((await client.put(path+'/preferences',{cycleStartDay:31,numberStyle:'commas',currency:'USD'})).status,400);
  await expectData(await client.put(path+'/preferences',{cycleStartDay:31,numberStyle:'commas'}));
  assert.deepEqual((await expectData(await client.get('/api/auth/me'))).preferences,{currency:'VND',numberStyle:'commas',cycleStartDay:31});
  assert.equal((await expectData(await other.get(path))).preferences.cycleStartDay,1);
  const month='2025-02';
  const report=await expectData(await client.get('/api/reports?month='+month));
  assert.deepEqual(report.cycle,{month,from:'2025-02-28',to:'2025-03-30',through:'2025-03-30',isCurrent:false});
  assert.equal(report.totals.expense,'50');
  assert.equal(report.report.series[2].spent,'10');
  assert.equal(report.report.categories[0].name,customized.name);
  assert.equal(report.report.categories[0].color,customized.color);
  const list=await expectData(await client.get(api+'?kind=expense&period='+month));
  assert.deepEqual(list.items.map(item=>item.amount),['30','20']);
  assert.equal((await summary(client,'2025-03')).totals.expense,'40');
  const backupResponse=await client.get(path+'/backup');
  assert.equal(backupResponse.status,200);
  assert.match(backupResponse.headers.get('content-disposition'),/attachment;.*\.json/);
  const backup=await backupResponse.json();
  assert.equal(backup.version,1);
  assert.ok(Date.parse(backup.exportedAt));
  assert.equal(backup.data.transactions.length,4);
  assert.ok(backup.data.categories.some(item=>item.id===custom.id));
  assert.ok(!backup.data.categories.some(item=>item.id===bankFood.id));
  assert.doesNotMatch(JSON.stringify(backup),/password_hash|token_hash|la_session|otp|auth_version|other-settings@example\.test/i);
  assert.equal((await client.post(path+'/restore-defaults',{})).status,400);
  await expectData(await client.post(path+'/restore-defaults',{confirm:true}));
  const restored=await state();
  assert.equal(restored.profile.fullName,'Test Ledger');
  assert.equal(restored.preferences.cycleStartDay,1);
  assert.equal(restored.preferences.numberStyle,'dots');
  assert.deepEqual(restored.categories.find(item=>item.id===food.id),{...food,hiddenAt:null});
  assert.ok(restored.categories.some(item=>item.id===custom.id));
  assert.equal((await expectData(await client.get(api))).total,4);
  assert.equal((await expectData(await client.get('/api/budgets?month=2025-02'))).items[0].id,budget.items[0].id);
});

test('changing the password requires the current password and revokes old sessions',async t=>{
  const f=await setup(t), client=f.client;
  await profile(f,client);
  const otherSession=createClient(f.base);
  await otherSession.init();
  const login=password=>({type:'email',identifier:account.email,password});
  await expectData(await otherSession.post('/api/auth/login',login(account.password)));
  const changed={currentPassword:account.password,password:'MatKhauMoi2027',confirmPassword:'MatKhauMoi2027'};
  const path='/api/settings/password';
  assert.equal((await client.post(path,{...changed,currentPassword:'MatKhauSai123'})).status,400);
  assert.equal((await client.post(path,{...changed,confirmPassword:'KhongKhop123'})).status,400);
  await expectData(await client.post(path,changed));
  assert.equal((await client.get('/api/auth/me')).status,401);
  assert.equal((await otherSession.get('/api/auth/me')).status,401);
  assert.equal((await client.post('/api/auth/login',login(account.password))).status,401);
  await expectData(await client.post('/api/auth/login',login(changed.password)));
});
