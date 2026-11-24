import { test } from 'node:test';
import assert from 'node:assert/strict';
import { account, createClient, register, setup } from '../support/fixture.mjs';
import { currentBudgetMonth, renewDueBudgets } from '../../BackEnd/services/budgets.js';

async function data(response,status=200) {
  const result = await response.json();
  assert.equal(response.status,status,JSON.stringify(result));
  return result.data;
}
function monthOffset(offset) {
  const date = new Date(currentBudgetMonth()+'-01T00:00:00Z');
  date.setUTCMonth(date.getUTCMonth()+offset);
  return date.toISOString().slice(0,7);
}
async function userFixture(f,client=f.client,credentials=account) {
  await client.init();
  await data(await register(client,credentials),201);
  const [user] = await f.db.execute('SELECT id FROM users WHERE email=?',[credentials.email]);
  await f.db.call('la_onboarding_save_profile',[user.id,'Test Budget','2000-01-01','Hà Nội','0','save_money',null]);
  await f.db.execute('UPDATE users SET email_verified_at=UTC_TIMESTAMP(6) WHERE id=?',[user.id]);
  await f.db.call('la_onboarding_complete',[user.id]);
  await data(await client.post('/api/auth/login',{type:'email',identifier:credentials.email,password:credentials.password}));
  await data(await client.post('/api/transactions/options',{resource:'starter'}),201);
  const {wallets,categories} = await data(await client.get('/api/transactions/options'));
  return {
    id:user.id,walletId:wallets[0].id,food:categories.find(item=>item.name==='Ăn uống').id,
    travel:categories.find(item=>item.name==='Đi lại').id,income:categories.find(item=>item.kind==='income').id,
  };
}
const period = async(client,month)=>data(await client.get('/api/budgets?month='+month));
const create = async(client,categoryId,month,baseAmount,options={})=>data(await client.post('/api/budgets',{categoryId,month,baseAmount,...options}),201);
const txBody = (user,month,categoryId,amount,kind='expense')=>({walletId:user.walletId,kind,categoryId,date:month+'-10',amount});
const transaction = async(client,body)=>data(await client.post('/api/transactions',body),201);

test('budgets enforce ownership and uniqueness and distinguish warning, exhausted and overage',async t=>{
  const f = await setup(t), client = f.client;
  const user = await userFixture(f);
  const other = createClient(f.base);
  const foreign = await userFixture(f,other,{...account,email:'other-budget@example.test',phone:'0972223333'});
  const month = currentBudgetMonth();
  const defaults = {month,categoryId:user.food,baseAmount:'100000'};
  assert.equal((await client.post('/api/budgets',{...defaults,categoryId:foreign.food})).status,400);
  assert.equal((await client.post('/api/budgets',{...defaults,categoryId:user.income})).status,400);
  for (const changes of [{baseAmount:'0'},{threshold:0},{threshold:101},{threshold:'80'},{autoRenew:'yes'}]) {
    assert.equal((await client.post('/api/budgets',{...defaults,...changes})).status,400);
  }
  const original = await create(client,user.food,month,'100000');
  assert.equal(original.items[0].threshold,80);
  await create(client,user.travel,month,'500000');
  assert.equal((await client.post('/api/budgets',defaults)).status,409);
  await transaction(client,txBody(user,month,user.income,'500000','income'));
  await transaction(other,txBody(foreign,month,foreign.food,'200000'));
  const expense = await transaction(client,txBody(user,month,user.food,'79999'));
  for (const [amount,status,percent] of [['79999','normal','79.99'],['80000','warning','80'],['100000','exhausted','100'],['115000','over','115']]) {
    await data(await client.put('/api/transactions/'+expense.id,txBody(user,month,user.food,amount)));
    const summary = await period(client,month);
    const food = summary.items.find(item=>item.categoryId===user.food);
    assert.equal(food.status,status);
    assert.equal(food.percent,percent);
  }
  const over = await period(client,month);
  assert.deepEqual(over.totals,{available:'600000',spent:'115000',remaining:'485000'});
  assert.deepEqual(over.overBudget,[{category:'Ăn uống',overage:'15000'}]);
  assert.deepEqual((await period(other,month)).items,[]);
  await data(await client.delete('/api/transactions/'+expense.id,{}));
  assert.deepEqual((await period(client,month)).overBudget,[]);
  assert.equal((await period(client,month)).totals.remaining,'600000');
});

test('catch-up is idempotent, preserves manual months and recalculates the rollover chain on ledger changes',async t=>{
  const f = await setup(t), client = f.client, user = await userFixture(f);
  const [start,second,third,current] = [-3,-2,-1,0].map(monthOffset);
  const before = await transaction(client,txBody(user,start,user.food,'2400000'));
  await transaction(client,txBody(user,second,user.food,'3450000'));
  await transaction(client,txBody(user,start,user.travel,'3500000'));
  await create(client,user.travel,second,'4000000',{threshold:65,autoRenew:false});
  // Simulate server downtime: only the original rows had been stored at this point.
  for(const category of [user.food,user.travel]) {
    await f.db.execute('INSERT INTO finance_budgets(user_id,category_id,period,base_amount,threshold,auto_renew) VALUES (?,?,?,?,80,1)',[user.id,category,start+'-01','3000000']);
  }
  await Promise.all([renewDueBudgets(f.db,current),renewDueBudgets(f.db,current)]);
  await renewDueBudgets(f.db,current);
  const food = async month=>(await period(client,month)).items.find(item=>item.categoryId===user.food);
  const travel = async month=>(await period(client,month)).items.find(item=>item.categoryId===user.travel);
  assert.equal((await food(second)).carryAmount,'600000');
  assert.equal((await food(second)).available,'3600000');
  assert.equal((await food(third)).carryAmount,'150000');
  assert.equal((await food(current)).carryAmount,'3150000');
  assert.equal((await food(current)).baseAmount,'3000000');
  assert.equal((await travel(second)).baseAmount,'4000000');
  assert.equal((await travel(second)).threshold,65);
  assert.equal((await travel(second)).autoRenew,false);
  assert.equal((await travel(second)).carryAmount,'0');
  assert.equal(await travel(third),undefined);
  assert.equal((await f.db.execute('SELECT COUNT(*) AS total FROM finance_budgets'))[0].total,'6');
  await data(await client.put('/api/transactions/'+before.id,txBody(user,start,user.food,'2000000')));
  assert.equal((await food(second)).carryAmount,'1000000');
  assert.equal((await food(third)).carryAmount,'550000');
  assert.equal((await food(current)).carryAmount,'3550000');
  await data(await client.put('/api/transactions/'+before.id,txBody(user,second,user.travel,'1000000')));
  assert.equal((await food(second)).carryAmount,'3000000');
  assert.equal((await food(third)).carryAmount,'2550000');
  assert.equal((await travel(second)).spent,'1000000');
  assert.equal((await travel(second)).remaining,'3000000');
  await data(await client.delete('/api/transactions/'+before.id,{}));
  const reports = await data(await client.get('/api/finance/summary?month='+second));
  assert.equal(reports.budgets.items.find(item=>item.categoryId===user.travel).spent,'0');

  // A later manual month also receives positive carry while keeping its terms.
  await create(client,user.travel,third,'1000000',{threshold:75});
  const travelExpense = (await data(await client.get('/api/transactions?kind=expense&categoryId='+user.travel))).items[0];
  await data(await client.put('/api/transactions/'+travelExpense.id,txBody(user,start,user.travel,'2500000')));
  assert.equal((await travel(second)).carryAmount,'500000');
  assert.equal((await travel(second)).baseAmount,'4000000');
  assert.equal((await travel(third)).carryAmount,'0');
});
