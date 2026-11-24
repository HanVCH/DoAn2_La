import { financeCycle, financeMonthOffset } from '../../shared/transaction-policy.mjs';

const rounded = (value,divisor)=>(value<0n ? -1n : 1n)*((value<0n ? -value : value)*2n+divisor)/(divisor*2n);

function percentage(value,base) {
  if (base===0n) return null;
  const hundredths = rounded(value*10000n,base);
  const magnitude = hundredths<0n ? -hundredths : hundredths;
  const fraction = String(magnitude%100n).padStart(2,'0').replace(/0+$/,'');
  return (hundredths<0n ? '-' : '')+String(magnitude/100n)+(fraction ? '.'+fraction : '');
}

function comparison(current,sum,months) {
  const difference = current*months-sum;
  return {
    reference:rounded(sum,months).toString(),
    difference:rounded(difference,months).toString(),
    direction:difference>0n ? 'up' : difference<0n ? 'down' : 'same',
    percent:percentage(difference,sum),
  };
}

export async function spendingReport(db,user,cycle,cycleStartDay,totalExpense) {
  const previousCycles = [-3,-2,-1].map(offset=>financeCycle(financeMonthOffset(cycle.month,offset),cycleStartDay));
  const cycles = [...previousCycles,cycle];
  const [categories,history] = await Promise.all([
    db.execute(`SELECT c.id,COALESCE(c.name,'Chưa phân loại') AS name,c.icon,c.color,CAST(SUM(t.amount) AS CHAR) AS spent
      FROM finance_transactions t LEFT JOIN finance_categories c ON c.user_id=t.user_id AND c.id=t.category_id AND c.kind=t.kind
      WHERE t.user_id=? AND t.kind='expense' AND t.deleted_at IS NULL AND t.transaction_date BETWEEN ? AND ?
      GROUP BY c.id,c.name,c.icon,c.color ORDER BY SUM(t.amount) DESC,c.name,c.id`,[user,cycle.from,cycle.through]),
    db.execute(`SELECT CASE WHEN t.transaction_date<? THEN 0 WHEN t.transaction_date<? THEN 1 ELSE 2 END AS bucket,
        CAST(SUM(t.amount) AS CHAR) AS spent
      FROM finance_transactions t
      WHERE t.user_id=? AND t.kind='expense' AND t.deleted_at IS NULL AND t.transaction_date>=? AND t.transaction_date<?
      GROUP BY bucket`,[previousCycles[1].from,previousCycles[2].from,user,previousCycles[0].from,cycle.from]),
  ]);
  const earlier = new Map(history.map(entry=>[Number(entry.bucket),entry.spent]));
  const series = cycles.map(({month,from,to},index)=>({month,from,to,spent:index===3 ? totalExpense : earlier.get(index) ?? '0'}));
  const total = BigInt(totalExpense);
  const previous = BigInt(series[2].spent);
  const lastThree = series.slice(0,3).reduce((sum,entry)=>sum+BigInt(entry.spent),0n);
  return {
    asOf:cycle.isCurrent ? cycle.through : null,
    categories:categories.map(item=>({...item,percent:percentage(BigInt(item.spent),total)})),
    series,
    comparisons:{previous:comparison(total,previous,1n),average:comparison(total,lastThree,3n)},
  };
}
