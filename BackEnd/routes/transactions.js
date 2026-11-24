import { Router } from 'express';
import { ApiError, reply } from '../middleware/errors.js';
import { csrfGuard } from '../middleware/security.js';
import { listCategories, saveCategory, seedCategories } from '../services/categories.js';
import { readPreferences } from '../services/preferences.js';
import { listGoals } from './goals.js';
import { getBudgetPeriod, lockBudgetOwner, reconcileBudgets } from '../services/budgets.js';
import { checkWalletBalances, listWallets, walletTotals } from '../services/wallets.js';
import { spendingReport } from '../services/reports.js';
import { financeCycle, financeKinds, isFinanceDate, isFinanceId, isVnd, localFinanceDate, validateTransaction } from '../../shared/transaction-policy.mjs';

const fields = `t.id,t.kind,t.amount,t.wallet_id AS walletId,t.category_id AS categoryId,
  DATE_FORMAT(t.transaction_date,'%Y-%m-%d') AS date,t.note,t.revision,t.deleted_at AS deletedAt,
  w.name AS wallet,COALESCE(c.name,'Chưa phân loại') AS category,c.icon AS categoryIcon,c.color AS categoryColor`;
const joins = `FROM finance_transactions t
  JOIN finance_wallets w ON w.user_id=t.user_id AND w.id=t.wallet_id
  LEFT JOIN finance_categories c ON c.user_id=t.user_id AND c.id=t.category_id AND c.kind=t.kind`;
const notFound = () => new ApiError(404,'TRANSACTION_NOT_FOUND','Không tìm thấy giao dịch.');
const invalid = (message, errors) => new ApiError(400,'FINANCE_INVALID',message,errors ? {errors} : null);
const parseState = value => typeof value === 'string' ? JSON.parse(value) : value;
const sortable = {
  newest:'t.transaction_date DESC,t.id DESC', oldest:'t.transaction_date,t.id',
  amountAsc:'t.amount,t.transaction_date DESC,t.id DESC', amountDesc:'t.amount DESC,t.transaction_date DESC,t.id DESC',
};

function filters(query, userId) {
  const conditions = ['t.user_id=?', query.deleted === '1' ? 't.deleted_at IS NOT NULL' : 't.deleted_at IS NULL'];
  const parameters = [userId];
  const add = (value, valid, sql) => {
    if (value === undefined || value === '') return;
    if (!valid(value)) throw invalid('Bộ lọc giao dịch không hợp lệ.');
    conditions.push(sql);
    parameters.push(value);
  };
  add(query.from,isFinanceDate,'t.transaction_date>=?');
  add(query.to,isFinanceDate,'t.transaction_date<=?');
  add(query.kind,value=>financeKinds.includes(value),'t.kind=?');
  add(query.walletId,isFinanceId,'t.wallet_id=?');
  add(query.categoryId,isFinanceId,'t.category_id=?');
  add(query.min,isVnd,'t.amount>=CAST(? AS DECIMAL(18,0))');
  add(query.max,isVnd,'t.amount<=CAST(? AS DECIMAL(18,0))');
  add(query.q,value=>typeof value==='string' && value.length<=500,'LOCATE(?,t.note)>0');
  if ((query.from && query.to && query.from > query.to) || (query.min && query.max && BigInt(query.min)>BigInt(query.max))) {
    throw invalid('Mốc bắt đầu phải nhỏ hơn hoặc bằng mốc kết thúc.');
  }
  return { where:conditions.join(' AND '), parameters };
}

async function find(db, userId, id, lock = false) {
  if (!isFinanceId(id)) throw notFound();
  const [row] = await db.execute(`SELECT ${fields} ${joins} WHERE t.user_id=? AND t.id=?${lock ? ' FOR UPDATE' : ''}`,[userId,id]);
  if (!row) throw notFound();
  return row;
}

async function validateOwnership(db, userId, data, before) {
  const [wallet] = await db.execute('SELECT id,archived_at AS archivedAt FROM finance_wallets WHERE user_id=? AND id=?',[userId,data.walletId]);
  const [category] = await db.execute('SELECT id,hidden_at AS hiddenAt FROM finance_categories WHERE user_id=? AND id=? AND kind=?',[userId,data.categoryId,data.kind]);
  const errors = {};
  if (!wallet) errors.walletId = 'Ví không thuộc tài khoản của bạn.';
  else if (wallet.archivedAt && data.walletId!==before?.walletId) errors.walletId = 'Ví đã lưu trữ. Chọn ví đang hoạt động.';
  if (!category) errors.categoryId = 'Danh mục không có hoặc không phù hợp với loại giao dịch.';
  else if (category.hiddenAt && data.categoryId!==before?.categoryId) errors.categoryId = 'Danh mục đã ẩn. Chọn danh mục đang hiển thị.';
  if (Object.keys(errors).length) throw invalid('Kiểm tra lại ví và danh mục.',errors);
}

function assertRevision(body, before) {
  if (body?.revision !== undefined && body.revision !== before.revision) {
    throw new ApiError(409,'TRANSACTION_CHANGED','Giao dịch đã thay đổi. Hãy tải lại chi tiết.');
  }
}

export function createTransactionsRouter({ db, config }) {
  const router = Router();
  router.use((_request,response,next)=>{
    response.set('Cache-Control','no-store');
    next();
  });
  router.use((request,response,next)=>request.method === 'GET' ? next() : csrfGuard(config)(request,response,next));

  router.get('/options',async(request,response)=>{
    const user = request.authUser.id;
    const [wallets,categories] = await Promise.all([
      db.execute('SELECT id,name,kind,archived_at AS archivedAt FROM finance_wallets WHERE user_id=? ORDER BY name,id',[user]),
      listCategories(db,user),
    ]);
    reply(response,200,'FINANCE_OPTIONS','Tùy chọn giao dịch.',{wallets:wallets.filter(wallet=>!wallet.archivedAt),archivedWallets:wallets.filter(wallet=>wallet.archivedAt),categories});
  });
  router.post('/options',async(request,response)=>{
    const user = request.authUser.id;
    const { resource, name, kind, icon } = request.body || {};
    let created = null;
    try {
      if (resource === 'starter') {
        await db.transaction(async tx=>{
          await lockBudgetOwner(tx,user);
          await tx.execute("INSERT INTO finance_wallets(user_id,name) VALUES (?,'Tiền mặt') ON DUPLICATE KEY UPDATE id=id",[user]);
          await seedCategories(tx,user);
        });
      } else {
        if (typeof name !== 'string' || !name.trim() || name.trim().length>80) throw invalid('Nhập tên từ 1 đến 80 ký tự.');
        if (resource === 'wallet') await db.transaction(async tx=>{
          await lockBudgetOwner(tx,user);
          await tx.execute('INSERT INTO finance_wallets(user_id,name) VALUES (?,?)',[user,name.trim()]);
        });
        else if (resource === 'category' && financeKinds.includes(kind)) {
          created = await db.transaction(async tx=>{
            await lockBudgetOwner(tx,user);
            return saveCategory(tx,user,{kind,name,icon});
          });
        }
        else throw invalid('Chọn loại dữ liệu cần tạo.');
      }
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') throw new ApiError(409,'FINANCE_OPTION_EXISTS','Tên này đã được sử dụng.');
      throw error;
    }
    reply(response,201,'FINANCE_OPTION_SAVED','Đã lưu ví và danh mục.',created);
  });

  router.get('/',async(request,response)=>{
    const user = request.authUser.id;
    const {period:requestedPeriod} = request.query;
    if (requestedPeriod!==undefined && (typeof requestedPeriod!=='string' || (requestedPeriod && requestedPeriod!=='current' && !isFinanceDate(requestedPeriod+'-01')))) {
      throw invalid('Kỳ giao dịch không hợp lệ.');
    }
    const sort = request.query.sort ?? 'newest';
    const rawPage = request.query.page ?? '1';
    if (typeof sort !== 'string' || !Object.hasOwn(sortable,sort) || typeof rawPage !== 'string' || !/^[1-9]\d{0,7}$/.test(rawPage)) throw invalid('Tham số sắp xếp hoặc trang không hợp lệ.');
    const pageSize = 15;
    const data = await db.transaction(async tx=>{
      const cycle = requestedPeriod ? financeCycle(requestedPeriod==='current' ? undefined : requestedPeriod,(await readPreferences(tx,user)).cycleStartDay) : null;
      const {where,parameters} = filters(cycle ? {...request.query,from:cycle.from,to:cycle.through} : request.query,user);
      const [count] = await tx.execute(`SELECT COUNT(*) AS total FROM finance_transactions t WHERE ${where}`,parameters);
      const total = Number(count.total);
      const pages = Math.max(1,Math.ceil(total/pageSize));
      const page = Math.min(Number(rawPage),pages);
      const items = await tx.execute(`SELECT ${fields} ${joins} WHERE ${where} ORDER BY ${sortable[sort]} LIMIT ? OFFSET ?`,[...parameters,pageSize,(page-1)*pageSize]);
      let matchesFilter;
      if (isFinanceId(request.query.matchId)) {
        const [match] = await tx.execute(`SELECT 1 FROM finance_transactions t WHERE ${where} AND t.id=?`,[...parameters,request.query.matchId]);
        matchesFilter = Boolean(match);
      }
      return { items,total,page,pages,matchesFilter,...(cycle ? {cycle} : {}) };
    });
    reply(response,200,'TRANSACTIONS_LIST','Danh sách giao dịch.',data);
  });
  router.get('/:id/history',async(request,response)=>{
    const user = request.authUser.id;
    await find(db,user,request.params.id);
    const rows = await db.execute(`SELECT id,action,before_state AS beforeState,after_state AS afterState,changed_at AS changedAt
      FROM finance_transaction_history WHERE user_id=? AND transaction_id=? ORDER BY id DESC`,[user,request.params.id]);
    reply(response,200,'TRANSACTION_HISTORY','Lịch sử giao dịch.',rows.map(row=>({...row,beforeState:parseState(row.beforeState),afterState:parseState(row.afterState)})));
  });
  router.get('/:id',async(request,response)=>{
    reply(response,200,'TRANSACTION_DETAIL','Chi tiết giao dịch.',await find(db,request.authUser.id,request.params.id));
  });
  const save = async(request,response)=>{
    const user = request.authUser.id;
    const data = request.body || {};
    const errors = validateTransaction(data);
    if (Object.keys(errors).length) throw invalid('Kiểm tra lại thông tin giao dịch.',errors);
    const item = await db.transaction(async tx=>{
      await lockBudgetOwner(tx,user);
      const before = request.params.id ? await find(tx,user,request.params.id,true) : null;
      if (before?.deletedAt) throw notFound();
      if (before) assertRevision(data,before);
      await validateOwnership(tx,user,data,before);
      const values = [data.kind,data.amount,data.walletId,data.categoryId,data.date,data.note?.trim() || ''];
      let id = before?.id;
      if (before) await tx.execute(`UPDATE finance_transactions SET kind=?,amount=?,wallet_id=?,category_id=?,
        transaction_date=?,note=?,revision=revision+1 WHERE user_id=? AND id=?`,[...values,user,id]);
      else {
        await tx.execute(`INSERT INTO finance_transactions(kind,amount,wallet_id,category_id,transaction_date,note,user_id)
          VALUES (?,?,?,?,?,?,?)`,[...values,user]);
        [{id}] = await tx.execute('SELECT CAST(LAST_INSERT_ID() AS CHAR) AS id');
      }
      const after = await find(tx,user,id);
      await checkWalletBalances(tx,user,[...new Set([data.walletId,before?.walletId].filter(Boolean))]);
      await tx.execute(`INSERT INTO finance_transaction_history(user_id,transaction_id,action,before_state,after_state)
        VALUES (?,?,?,?,?)`,[user,id,before?'update':'create',before ? JSON.stringify(before) : null,JSON.stringify(after)]);
      if (before?.kind==='expense' || after.kind==='expense') await reconcileBudgets(tx,user);
      return after;
    });
    reply(response,request.params.id?200:201,'TRANSACTION_SAVED','Đã lưu giao dịch.',item);
  };
  router.post('/',save);
  router.put('/:id',save);
  router.delete('/:id',async(request,response)=>{
    const user = request.authUser.id;
    await db.transaction(async tx=>{
      await lockBudgetOwner(tx,user);
      const before = await find(tx,user,request.params.id,true);
      if (before.deletedAt) throw notFound();
      assertRevision(request.body,before);
      await tx.execute('UPDATE finance_transactions SET deleted_at=UTC_TIMESTAMP(6),revision=revision+1 WHERE user_id=? AND id=?',[user,before.id]);
      await checkWalletBalances(tx,user,[before.walletId]);
      await tx.execute(`INSERT INTO finance_transaction_history(user_id,transaction_id,action,before_state)
        VALUES (?,?,'delete',?)`,[user,before.id,JSON.stringify(before)]);
      if (before.kind==='expense') await reconcileBudgets(tx,user);
    });
    reply(response,200,'TRANSACTION_DELETED','Đã xóa giao dịch.');
  });
  return router;
}

const sums = `CAST(COALESCE(SUM(CASE WHEN t.kind='income' THEN t.amount ELSE 0 END),0) AS CHAR) AS income,
  CAST(COALESCE(SUM(CASE WHEN t.kind='expense' THEN t.amount ELSE 0 END),0) AS CHAR) AS expense`;

export async function financeSummary(db,user,month,{report=false}={}) {
  const today = localFinanceDate();
  if (month!==undefined && (typeof month!=='string' || !isFinanceDate(month+'-01'))) throw invalid('Kỳ báo cáo không hợp lệ.');
  return db.transaction(async tx=>{
    await lockBudgetOwner(tx,user);
    await reconcileBudgets(tx,user);
    const {cycleStartDay} = await readPreferences(tx,user);
    const cycle = financeCycle(month,cycleStartDay,today);
    const period = [cycle.from,cycle.through];
    const [totals] = await tx.execute(`SELECT COUNT(*) AS count,${sums} FROM finance_transactions t
      WHERE t.user_id=? AND t.deleted_at IS NULL AND t.transaction_date BETWEEN ? AND ?`,[user,...period]);
    const wallets = await listWallets(tx,user);
    const balances = walletTotals(wallets);
    const budgets = await getBudgetPeriod(tx,user,report || month ? cycle.month : today.slice(0,7));
    const periods = await tx.execute(`SELECT DATE_FORMAT(t.transaction_date,'%Y-%m') AS month,${sums} FROM finance_transactions t
      WHERE t.user_id=? AND t.deleted_at IS NULL
        AND (t.transaction_date<=? OR DATE_FORMAT(t.transaction_date,'%Y-%m')<>?)
      GROUP BY month ORDER BY month DESC LIMIT 24`,[user,today,today.slice(0,7)]);
    const data = {month:cycle.month,cycle,totals,balance:balances.net,walletTotals:balances,wallets,budgets,periods};
    if (report) return {...data,report:await spendingReport(tx,user,cycle,cycleStartDay,totals.expense)};
    const spending = await tx.execute(`SELECT c.id,c.name,c.icon,CAST(COALESCE(SUM(t.amount),0) AS CHAR) AS spent
      FROM finance_categories c LEFT JOIN finance_transactions t ON t.user_id=c.user_id AND t.category_id=c.id
      AND t.kind='expense' AND t.deleted_at IS NULL AND t.transaction_date BETWEEN ? AND ?
      WHERE c.user_id=? AND c.kind='expense' GROUP BY c.id,c.name,c.icon ORDER BY SUM(t.amount) DESC,c.name`,[...period,user]);
    const recent = await tx.execute(`SELECT ${fields} ${joins} WHERE t.user_id=? AND t.deleted_at IS NULL
      ORDER BY ${sortable.newest} LIMIT 5`,[user]);
    const daily = await tx.execute(`SELECT DATE_FORMAT(t.transaction_date,'%Y-%m-%d') AS date,${sums}
      FROM finance_transactions t WHERE t.user_id=? AND t.deleted_at IS NULL AND t.transaction_date BETWEEN ? AND ?
      GROUP BY t.transaction_date ORDER BY t.transaction_date`,[user,...period]);
    const goals = await listGoals(tx,user,{preview:true});
    return {...data,spending,recent,daily,goals};
  });
}
