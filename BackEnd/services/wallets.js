import { ApiError } from '../middleware/errors.js';

export const walletKinds = ['cash','bank','ewallet','credit'];
export const movementKinds = ['income','expense','transfer','adjustment','payment'];
export const isSignedVnd = value=>typeof value==='string' && /^(?:0|-?[1-9]\d{0,17})$/.test(value);
const transactionDelta = "IF((t.kind='income')=(w.kind='credit'),-t.amount,t.amount)";
const walletFields = `w.id,w.name,w.kind,w.opening_amount AS openingAmount,w.credit_limit AS creditLimit,
  DATE_FORMAT(w.payment_due,'%Y-%m-%d') AS paymentDue,w.note,w.archived_at AS archivedAt`;

export async function listWallets(db,user,ids) {
  const filter = ids?.length ? ` AND w.id IN (${ids.map(()=>'?').join(',')})` : '';
  const rows = await db.execute(`SELECT ${walletFields},CAST(w.opening_amount
    +COALESCE((SELECT SUM(${transactionDelta}) FROM finance_transactions t
      WHERE t.user_id=w.user_id AND t.wallet_id=w.id AND t.deleted_at IS NULL),0)
    +COALESCE((SELECT SUM(m.delta) FROM finance_wallet_movements m
      WHERE m.user_id=w.user_id AND m.wallet_id=w.id),0) AS CHAR) AS balance
    FROM finance_wallets w WHERE w.user_id=?${filter} ORDER BY w.name,w.id`,[user,...(ids ?? [])]);
  return rows.map(wallet=>{
    if (wallet.kind!=='credit') return wallet;
    const remaining = BigInt(wallet.creditLimit)-BigInt(wallet.balance);
    return {...wallet,creditAvailable:(remaining>0n ? remaining : 0n).toString()};
  });
}

export function walletTotals(wallets) {
  let assets = 0n, debt = 0n;
  for (const wallet of wallets) {
    if (wallet.kind==='credit') debt += BigInt(wallet.balance);
    else assets += BigInt(wallet.balance);
  }
  return {assets:assets.toString(),debt:debt.toString(),net:(assets-debt).toString()};
}

export async function getWallet(db,user,id) {
  const [wallet] = await listWallets(db,user,[id]);
  if (!wallet) throw new ApiError(404,'WALLET_NOT_FOUND','Không tìm thấy ví.');
  return wallet;
}

export async function checkWalletBalances(tx,user,ids) {
  for (const wallet of await listWallets(tx,user,ids)) {
    if (wallet.archivedAt && wallet.balance!=='0') throw new ApiError(409,'WALLET_ARCHIVED','Hãy khôi phục ví đã lưu trữ trước khi thay đổi số dư.');
    if (wallet.kind==='credit' && BigInt(wallet.balance)<0n) throw new ApiError(409,'WALLET_NEGATIVE_DEBT','Thao tác sẽ làm dư nợ thẻ âm. Hãy kiểm tra các khoản thanh toán và hoàn tiền đã ghi.');
  }
}

export async function walletHistory(db,user,wallet,{from,to,kind,page}) {
  const entries = `SELECT t.transaction_date AS day,CAST(${transactionDelta} AS CHAR) AS delta,
      t.kind,t.id,t.note,COALESCE(c.name,'Chưa phân loại') AS description,0 AS source,
      (SELECT MIN(h.changed_at) FROM finance_transaction_history h WHERE h.user_id=t.user_id AND h.transaction_id=t.id) AS recorded
    FROM finance_transactions t JOIN finance_wallets w ON w.user_id=t.user_id AND w.id=t.wallet_id
    LEFT JOIN finance_categories c ON c.user_id=t.user_id AND c.id=t.category_id AND c.kind=t.kind
    WHERE t.user_id=? AND t.wallet_id=? AND t.deleted_at IS NULL AND t.transaction_date<=?
    UNION ALL
    SELECT m.movement_date,CAST(m.delta AS CHAR),m.kind,m.id,m.note,w.name,1,m.created_at
    FROM finance_wallet_movements m LEFT JOIN finance_wallets w ON w.user_id=m.user_id AND w.id=m.related_wallet_id
    WHERE m.user_id=? AND m.wallet_id=? AND m.movement_date<=?`;
  const rows = await db.execute(`SELECT DATE_FORMAT(e.day,'%Y-%m-%d') AS date,e.delta,e.kind,e.note,e.description
    FROM (${entries}) e ORDER BY e.day,e.recorded,e.source,e.id`,[user,wallet.id,to,user,wallet.id,to]);
  let opening = BigInt(wallet.openingAmount), running = opening;
  const daily = new Map(), matches = [];
  for (const row of rows) {
    running += BigInt(row.delta);
    if (row.date<from) {
      opening = running;
      continue;
    }
    daily.set(row.date,running.toString());
    if (!kind || row.kind===kind) matches.push({...row,balance:running.toString()});
  }
  const size = 20, pages = Math.max(1,Math.ceil(matches.length/size));
  const current = Math.min(page,pages);
  return {wallet,from,to,opening:opening.toString(),closing:running.toString(),page:current,pages,
    daily:[...daily].map(([date,balance])=>({date,balance})),items:matches.reverse().slice((current-1)*size,current*size)};
}
