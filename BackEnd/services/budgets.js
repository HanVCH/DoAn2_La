import { financePeriodEnd, isFinanceDate, localFinanceDate } from '../../shared/transaction-policy.mjs';

export const currentBudgetMonth = () => localFinanceDate().slice(0,7);
export const isBudgetMonth = month => typeof month==='string' && /^\d{4}-\d{2}$/.test(month) && month>='1900-01' && isFinanceDate(month+'-01');

function nextMonth(month) {
  if (month==='9999-12') return null;
  const date = new Date(month+'-01T00:00:00Z');
  date.setUTCMonth(date.getUTCMonth()+1);
  return date.toISOString().slice(0,7);
}

// Transactions and budget writers take this lock first, including the rollover job.
export function lockBudgetOwner(tx,userId) {
  return tx.execute('SELECT id FROM users WHERE id=? FOR UPDATE',[userId]);
}

const columns = `b.id,b.category_id AS categoryId,DATE_FORMAT(b.period,'%Y-%m') AS month,
  b.base_amount AS baseAmount,b.carry_amount AS carryAmount,b.threshold,b.auto_renew AS autoRenew`;

export async function reconcileBudgets(tx,userId,currentMonth = currentBudgetMonth()) {
  const rows = await tx.execute(`SELECT ${columns} FROM finance_budgets b WHERE b.user_id=? ORDER BY b.category_id,b.period`,[userId]);
  if (!rows.length) return;
  const earliest = rows.reduce((min,row)=>row.month<min ? row.month : min,rows[0].month);
  const expenses = await tx.execute(`SELECT t.category_id AS categoryId,DATE_FORMAT(t.transaction_date,'%Y-%m') AS month,
      CAST(SUM(t.amount) AS CHAR) AS spent
    FROM finance_transactions t
    WHERE t.user_id=? AND t.kind='expense' AND t.deleted_at IS NULL AND t.transaction_date>=?
      AND EXISTS (SELECT 1 FROM finance_budgets b WHERE b.user_id=t.user_id AND b.category_id=t.category_id)
    GROUP BY t.category_id,month`,[userId,earliest+'-01']);
  const spentByPeriod = new Map(expenses.map(row=>[row.categoryId+':'+row.month,BigInt(row.spent)]));
  const groups = Map.groupBy(rows,row=>row.categoryId);
  for (const [categoryId,periods] of groups) {
    let previous = null;
    let index = 0;
    while (true) {
      const existing = periods[index];
      const following = previous?.autoRenew ? nextMonth(previous.month) : null;
      const needsRenewal = following && following<=currentMonth && (!existing || following<existing.month);
      if (!existing && !needsRenewal) break;

      const row = needsRenewal ? {...previous,month:following,id:null} : periods[index++];
      const previousRemaining = previous && following===row.month
        ? BigInt(previous.baseAmount)+BigInt(previous.carryAmount)-previous.spent : 0n;
      const carryAmount = (previousRemaining>0n ? previousRemaining : 0n).toString();

      if (needsRenewal) {
        await tx.execute(`INSERT INTO finance_budgets
          (user_id,category_id,period,base_amount,carry_amount,threshold,auto_renew) VALUES (?,?,?,?,?,?,1)`,
        [userId,categoryId,row.month+'-01',row.baseAmount,carryAmount,row.threshold]);
      } else if (row.carryAmount!==carryAmount) {
        await tx.execute('UPDATE finance_budgets SET carry_amount=? WHERE user_id=? AND id=?',[carryAmount,userId,row.id]);
      }
      previous = {...row,carryAmount,spent:spentByPeriod.get(categoryId+':'+row.month) || 0n};
    }
  }
}

export function budgetAmounts(row) {
  const available = BigInt(row.baseAmount)+BigInt(row.carryAmount);
  const spent = BigInt(row.spent);
  const remaining = available-spent;
  const status = remaining<0n ? 'over' : remaining===0n ? 'exhausted'
    : spent*100n>=available*BigInt(row.threshold) ? 'warning' : 'normal';
  // Truncation preserves the warning threshold. Show a distinct value for small overages.
  const hundredths = spent*10000n/available;
  const shown = status==='over' && hundredths===10000n ? 10001n : hundredths;
  const decimal = String(shown%100n).padStart(2,'0').replace(/0+$/,'');
  return {
    ...row,autoRenew:Boolean(row.autoRenew),available:available.toString(),
    remaining:remaining.toString(),overage:(remaining<0n ? -remaining : 0n).toString(),
    percent:String(shown/100n)+(decimal ? '.'+decimal : ''),
    progress:shown>=10000n ? 100 : Number(shown)/100,status,
  };
}

export async function getBudgetPeriod(tx,userId,month,end=financePeriodEnd(month)) {
  const rows = await tx.execute(`SELECT ${columns},c.name AS category,c.icon AS categoryIcon,c.color AS categoryColor,
    CAST(COALESCE(SUM(t.amount),0) AS CHAR) AS spent
    FROM finance_budgets b
    JOIN finance_categories c ON c.user_id=b.user_id AND c.id=b.category_id
    LEFT JOIN finance_transactions t ON t.user_id=b.user_id AND t.category_id=b.category_id
      AND t.kind='expense' AND t.deleted_at IS NULL AND t.transaction_date BETWEEN b.period AND ?
    WHERE b.user_id=? AND b.period=?
    GROUP BY b.id,b.category_id,b.period,b.base_amount,b.carry_amount,b.threshold,b.auto_renew,c.name,c.icon,c.color
    ORDER BY c.name,b.id`,[end,userId,month+'-01']);
  const items = rows.map(budgetAmounts);
  const total = field=>items.reduce((sum,item)=>sum+BigInt(item[field]),0n).toString();
  return {
    month,items, totals:{available:total('available'),spent:total('spent'),remaining:total('remaining')},
    overBudget:items.filter(item=>item.status==='over').map(({category,overage})=>({category,overage})),
  };
}

export async function renewDueBudgets(db,currentMonth = currentBudgetMonth()) {
  const users = await db.execute(`SELECT DISTINCT b.user_id AS userId FROM finance_budgets b
    LEFT JOIN finance_budgets n ON n.user_id=b.user_id AND n.category_id=b.category_id
      AND n.period=DATE_ADD(b.period,INTERVAL 1 MONTH)
    WHERE b.auto_renew=1 AND b.period<? AND n.id IS NULL`,[currentMonth+'-01']);
  for (const {userId} of users) {
    await db.transaction(async tx=>{
      await lockBudgetOwner(tx,userId);
      await reconcileBudgets(tx,userId,currentMonth);
    });
  }
}
