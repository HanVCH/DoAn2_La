import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { ApiError, reply } from '../middleware/errors.js';
import { csrfGuard } from '../middleware/security.js';
import { isFinanceDate, isFinanceId, isVnd, localFinanceDate } from '../../shared/transaction-policy.mjs';
import { lockBudgetOwner } from '../services/budgets.js';
import { checkWalletBalances, getWallet, isSignedVnd, listWallets, movementKinds, walletHistory, walletKinds, walletTotals } from '../services/wallets.js';

const invalid = message=>new ApiError(400,'WALLET_INVALID',message);
const conflict = (code,message,data)=>new ApiError(409,code,message,data);
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

function walletId(id) {
  if (!isFinanceId(id)) throw new ApiError(404,'WALLET_NOT_FOUND','Không tìm thấy ví.');
  return id;
}

function active(wallet) {
  if (wallet.archivedAt) throw conflict('WALLET_ARCHIVED','Hãy khôi phục ví đã lưu trữ trước khi thao tác.');
}

function noteText(value='',required=false) {
  if (typeof value!=='string' || value.length>500 || (required && !value.trim())) throw invalid(required ? 'Nhập lý do điều chỉnh, tối đa 500 ký tự.' : 'Ghi chú tối đa 500 ký tự.');
  return value.trim();
}

function writeMovement(tx,{user,id,related=null,key,kind,delta,note,date=localFinanceDate()}) {
  return tx.execute(`INSERT INTO finance_wallet_movements(user_id,wallet_id,related_wallet_id,operation_key,kind,delta,movement_date,note)
    VALUES (?,?,?,?,?,?,?,?)`,[user,id,related,key,kind,delta,date,note]);
}

export function createWalletsRouter({db,config}) {
  const router = Router();
  router.use((request,response,next)=>{
    response.set('Cache-Control','no-store');
    return request.method==='GET' ? next() : csrfGuard(config)(request,response,next);
  });

  function write(user,work) {
    return db.transaction(async tx=>{
      // Same per-user lock as transaction writes and summary reads.
      await lockBudgetOwner(tx,user);
      return work(tx);
    });
  }

  router.get('/',async(request,response)=>{
    const items = await listWallets(db,request.authUser.id);
    reply(response,200,'WALLETS_LIST','Danh sách ví.',{items,totals:walletTotals(items)});
  });

  async function save(request,response) {
    const user = request.authUser.id, id = request.params.id;
    const {name,kind,openingAmount,creditLimit,paymentDue,note} = request.body || {};
    const credit = kind==='credit';
    if (typeof name!=='string' || !name.trim() || name.trim().length>80) throw invalid('Nhập tên ví từ 1 đến 80 ký tự.');
    if (!walletKinds.includes(kind)) throw invalid('Chọn loại ví hợp lệ.');
    if (!(credit ? isVnd(openingAmount) : isSignedVnd(openingAmount))) throw invalid('Nhập số dư hoặc dư nợ ban đầu bằng số nguyên VND hợp lệ.');
    if (credit && (!isVnd(creditLimit) || creditLimit==='0')) throw invalid('Nhập hạn mức tín dụng lớn hơn 0.');
    if (credit && paymentDue && !isFinanceDate(paymentDue)) throw invalid('Ngày đến hạn thanh toán không hợp lệ.');
    const values = [name.trim(),kind,openingAmount,credit ? creditLimit : null,credit && paymentDue ? paymentDue : null,noteText(note)];
    let wallet;
    try {
      wallet = await write(user,async tx=>{
        if (!id) {
          await tx.execute('INSERT INTO finance_wallets(name,kind,opening_amount,credit_limit,payment_due,note,user_id) VALUES (?,?,?,?,?,?,?)',[...values,user]);
          const [{id:created}] = await tx.execute('SELECT CAST(LAST_INSERT_ID() AS CHAR) AS id');
          return getWallet(tx,user,created);
        }
        const before = await getWallet(tx,user,walletId(id));
        active(before);
        if ((before.kind==='credit')!==credit) {
          const [used] = await tx.execute(`SELECT EXISTS(SELECT 1 FROM finance_transactions WHERE user_id=? AND wallet_id=?)
            OR EXISTS(SELECT 1 FROM finance_wallet_movements WHERE user_id=? AND wallet_id=?) AS used`,[user,id,user,id]);
          if (used.used) throw conflict('WALLET_TYPE_FIXED','Ví đã có lịch sử nên chỉ đổi được giữa các loại cùng cách tính số dư.');
        }
        await tx.execute('UPDATE finance_wallets SET name=?,kind=?,opening_amount=?,credit_limit=?,payment_due=?,note=? WHERE user_id=? AND id=?',[...values,user,id]);
        await checkWalletBalances(tx,user,[id]);
        return getWallet(tx,user,id);
      });
    } catch (error) {
      if (error.code==='ER_DUP_ENTRY') throw conflict('WALLET_NAME_EXISTS','Tên ví này đã được sử dụng.');
      throw error;
    }
    reply(response,id ? 200 : 201,'WALLET_SAVED','Đã lưu ví.',wallet);
  }

  router.post('/',save);
  router.put('/:id',save);
  router.get('/:id/history',async(request,response)=>{
    const today = localFinanceDate();
    const from = request.query.from || today.slice(0,7)+'-01', to = request.query.to || today;
    const kind = request.query.kind || '', page = request.query.page ?? '1';
    if (!isFinanceDate(from) || !isFinanceDate(to) || from>to || (kind && !movementKinds.includes(kind)) || typeof page!=='string' || !/^[1-9]\d{0,7}$/.test(page)) throw invalid('Khoảng ngày hoặc bộ lọc biến động không hợp lệ.');
    const user = request.authUser.id, id = walletId(request.params.id);
    const history = await db.transaction(async tx=>{
      const wallet = await getWallet(tx,user,id);
      return walletHistory(tx,user,wallet,{from,to,kind,page:Number(page)});
    });
    reply(response,200,'WALLET_HISTORY','Lịch sử biến động ví.',history);
  });

  router.put('/:id/archive',async(request,response)=>{
    const user = request.authUser.id, id = walletId(request.params.id);
    const {archived} = request.body || {};
    if (typeof archived!=='boolean') throw invalid('Chọn trạng thái lưu trữ hợp lệ.');
    const wallet = await write(user,async tx=>{
      const before = await getWallet(tx,user,id);
      if (archived && before.balance!=='0') throw conflict('WALLET_NOT_EMPTY','Chỉ lưu trữ ví khi số dư hoặc dư nợ bằng 0đ.');
      await tx.execute(`UPDATE finance_wallets SET archived_at=${archived ? 'COALESCE(archived_at,UTC_TIMESTAMP(6))' : 'NULL'} WHERE user_id=? AND id=?`,[user,id]);
      return getWallet(tx,user,id);
    });
    reply(response,200,'WALLET_ARCHIVE_SAVED','Đã cập nhật trạng thái ví.',wallet);
  });

  router.post('/:id/adjustments',async(request,response)=>{
    const user = request.authUser.id, id = walletId(request.params.id);
    const {actual,expectedBalance,reason} = request.body || {};
    const note = noteText(reason,true);
    if (typeof expectedBalance!=='string' || !/^-?\d{1,65}$/.test(expectedBalance) || !isSignedVnd(actual)) throw invalid('Nhập số dư thực tế bằng số nguyên VND hợp lệ.');
    const result = await write(user,async tx=>{
      const before = await getWallet(tx,user,id);
      active(before);
      if (before.kind==='credit' && !isVnd(actual)) throw invalid('Dư nợ thực tế phải từ 0đ trở lên.');
      if (before.balance!==expectedBalance) throw conflict('WALLET_BALANCE_CHANGED','Số dư đã thay đổi. Kiểm tra lại trước khi xác nhận.',{balance:before.balance});
      const delta = (BigInt(actual)-BigInt(before.balance)).toString();
      if (delta!=='0') await writeMovement(tx,{user,id,key:randomUUID(),kind:'adjustment',delta,note});
      return {wallet:await getWallet(tx,user,id),delta};
    });
    reply(response,200,'WALLET_ADJUSTED','Đã lưu điều chỉnh.',result);
  });

  router.post('/operations/:kind',async(request,response)=>{
    const user = request.authUser.id, kind = request.params.kind;
    const {sourceId,destinationId,amount,requestId} = request.body || {};
    const note = noteText(request.body?.note);
    const payment = kind==='payment';
    if (!payment && kind!=='transfer') throw invalid('Loại biến động không hợp lệ.');
    if (!isFinanceId(sourceId) || !isFinanceId(destinationId) || sourceId===destinationId) throw invalid('Chọn hai ví khác nhau.');
    if (!isVnd(amount) || amount==='0' || typeof requestId!=='string' || !uuid.test(requestId)) throw invalid('Số tiền hoặc mã yêu cầu không hợp lệ.');
    const sourceDelta = '-'+amount, destinationDelta = payment ? sourceDelta : amount;
    const result = await write(user,async tx=>{
      const existing = await tx.execute(`SELECT wallet_id AS id,related_wallet_id AS related,kind,delta,note
        FROM finance_wallet_movements WHERE user_id=? AND operation_key=?`,[user,requestId]);
      if (existing.length) {
        const same = (id,related,delta)=>existing.some(row=>row.id===id && row.related===related && row.delta===delta && row.kind===kind && row.note===note);
        if (existing.length!==2 || !same(sourceId,destinationId,sourceDelta) || !same(destinationId,sourceId,destinationDelta)) {
          throw conflict('WALLET_REQUEST_CONFLICT','Mã yêu cầu đã được dùng cho một thao tác khác.');
        }
        return {requestId,replayed:true};
      }
      const source = await getWallet(tx,user,sourceId), destination = await getWallet(tx,user,destinationId);
      active(source);
      active(destination);
      if (source.kind==='credit' || (destination.kind==='credit')!==payment) throw invalid('Loại ví không phù hợp với thao tác này.');
      if (BigInt(source.balance)<BigInt(amount)) throw conflict('WALLET_INSUFFICIENT','Ví thanh toán không đủ tiền.');
      if (payment && BigInt(destination.balance)<BigInt(amount)) throw conflict('WALLET_OVERPAYMENT','Khoản trả vượt dư nợ hiện tại của thẻ.');
      const movement = {user,key:requestId,kind,note,date:localFinanceDate()};
      await writeMovement(tx,{...movement,id:sourceId,related:destinationId,delta:sourceDelta});
      await writeMovement(tx,{...movement,id:destinationId,related:sourceId,delta:destinationDelta});
      return {requestId,replayed:false};
    });
    reply(response,result.replayed ? 200 : 201,'WALLET_OPERATION_SAVED',payment ? 'Đã thanh toán thẻ.' : 'Đã chuyển tiền.',result);
  });

  return router;
}
