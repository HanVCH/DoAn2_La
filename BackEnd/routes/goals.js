import { Router } from 'express';
import { ApiError, reply } from '../middleware/errors.js';
import { csrfGuard } from '../middleware/security.js';
import { isFinanceDate, isFinanceId, isVnd } from '../../shared/transaction-policy.mjs';

const projection = `id,name,target_amount AS targetAmount,saved_amount AS savedAmount,
  DATE_FORMAT(due_date,'%Y-%m-%d') AS dueDate,note`;
const ownedGoal = 'user_id=? AND id=? AND deleted_at IS NULL';
const invalid = message=>new ApiError(400,'GOAL_INVALID',message);
const notFound = ()=>new ApiError(404,'GOAL_NOT_FOUND','Không tìm thấy hũ chi tiêu.');

export function listGoals(db,userId,{preview=false}={}) {
  return db.execute(`SELECT ${projection} FROM finance_goals WHERE user_id=? AND deleted_at IS NULL
    ORDER BY id DESC${preview ? ' LIMIT 5' : ''}`,[userId]);
}

async function getGoal(db,userId,id,{lock=false}={}) {
  if (!isFinanceId(id)) throw notFound();
  const [goal] = await db.execute(`SELECT ${projection} FROM finance_goals WHERE ${ownedGoal}${lock ? ' FOR UPDATE' : ''}`,[userId,id]);
  if (!goal) throw notFound();
  return goal;
}

export function createGoalsRouter({db,config}) {
  const router = Router();
  router.use((_request,response,next)=>{response.set('Cache-Control','no-store');next();});
  router.get('/',async(request,response)=>{
    reply(response,200,'GOALS_LIST','Danh sách hũ chi tiêu.',await listGoals(db,request.authUser.id));
  });
  router.get('/:id',async(request,response)=>{
    reply(response,200,'GOAL_DETAIL','Chi tiết hũ chi tiêu.',await getGoal(db,request.authUser.id,request.params.id));
  });

  async function save(request,response) {
    const {name,targetAmount,savedAmount,dueDate,note} = request.body || {};
    const userId = request.authUser.id;
    const id = request.params.id;
    if (typeof name!=='string' || !name.trim() || name.trim().length>100) throw invalid('Nhập tên hũ từ 1 đến 100 ký tự.');
    if (!isVnd(targetAmount) || targetAmount==='0') throw invalid('Nhập số tiền mục tiêu bằng số nguyên VND lớn hơn 0.');
    if (savedAmount!==undefined && !isVnd(savedAmount)) throw invalid('Nhập số tiền đã dành bằng số nguyên VND không âm.');
    if (!id && savedAmount!==undefined && savedAmount!=='0') throw invalid('Hũ mới bắt đầu với số tiền đã dành là 0đ.');
    if (dueDate!=null && dueDate!=='' && !isFinanceDate(dueDate)) throw invalid('Chọn ngày dự kiến hoàn thành hợp lệ.');
    if (note!=null && (typeof note!=='string' || note.length>500)) throw invalid('Ghi chú tối đa 500 ký tự.');

    const goal = await db.transaction(async tx=>{
      if (!id) {
        await tx.execute('INSERT INTO finance_goals(user_id,name,target_amount,due_date,note) VALUES (?,?,?,?,?)',
          [userId,name.trim(),targetAmount,dueDate || null,note?.trim() || null]);
        const [{id:createdId}] = await tx.execute('SELECT CAST(LAST_INSERT_ID() AS CHAR) AS id');
        return getGoal(tx,userId,createdId);
      }
      const existing = await getGoal(tx,userId,id,{lock:true});
      await tx.execute(`UPDATE finance_goals SET name=?,target_amount=?,saved_amount=?,due_date=?,note=? WHERE ${ownedGoal}`,[
        name.trim(),targetAmount,savedAmount ?? existing.savedAmount,
        dueDate===undefined ? existing.dueDate : dueDate || null,
        note===undefined ? existing.note : note?.trim() || null,userId,id,
      ]);
      return getGoal(tx,userId,id);
    });
    reply(response,id ? 200 : 201,'GOAL_SAVED','Đã lưu hũ chi tiêu.',goal);
  }

  router.post('/',csrfGuard(config),save);
  router.put('/:id',csrfGuard(config),save);
  router.post('/:id/savings',csrfGuard(config),async(request,response)=>{
    const {amount} = request.body || {};
    if (!isVnd(amount) || amount==='0') throw invalid('Nhập số tiền thêm bằng số nguyên VND lớn hơn 0.');
    const userId = request.authUser.id, id = request.params.id;
    const goal = await db.transaction(async tx=>{
      const current = await getGoal(tx,userId,id,{lock:true});
      const total = (BigInt(current.savedAmount)+BigInt(amount)).toString();
      if (!isVnd(total)) throw invalid('Tổng số tiền đã dành vượt giới hạn 18 chữ số.');
      await tx.execute(`UPDATE finance_goals SET saved_amount=? WHERE ${ownedGoal}`,[total,userId,id]);
      return getGoal(tx,userId,id);
    });
    reply(response,200,'GOAL_SAVINGS_ADDED','Đã thêm tiền vào hũ.',goal);
  });
  router.put('/:id/savings',csrfGuard(config),async(request,response)=>{
    const {savedAmount} = request.body || {};
    if (!isVnd(savedAmount)) throw invalid('Nhập số tiền đã dành bằng số nguyên VND không âm.');
    const userId = request.authUser.id, id = request.params.id;
    const goal = await db.transaction(async tx=>{
      await getGoal(tx,userId,id,{lock:true});
      await tx.execute(`UPDATE finance_goals SET saved_amount=? WHERE ${ownedGoal}`,[savedAmount,userId,id]);
      return getGoal(tx,userId,id);
    });
    reply(response,200,'GOAL_SAVINGS_SAVED','Đã cập nhật số tiền đã dành.',goal);
  });
  router.delete('/:id',csrfGuard(config),async(request,response)=>{
    const userId = request.authUser.id, id = request.params.id;
    if (!isFinanceId(id)) throw notFound();
    const result = await db.execute(`UPDATE finance_goals SET deleted_at=UTC_TIMESTAMP(6) WHERE ${ownedGoal}`,[userId,id]);
    if (!result.affectedRows) throw notFound();
    reply(response,200,'GOAL_DELETED','Đã xóa hũ chi tiêu.',{id});
  });
  return router;
}
