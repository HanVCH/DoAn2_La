import { Router } from 'express';
import { ApiError, reply } from '../middleware/errors.js';
import { csrfGuard } from '../middleware/security.js';
import { isFinanceId, isVnd } from '../../shared/transaction-policy.mjs';
import { currentBudgetMonth, getBudgetPeriod, isBudgetMonth, lockBudgetOwner, reconcileBudgets } from '../services/budgets.js';

const invalid = message=>new ApiError(400,'BUDGET_INVALID',message);
export function createBudgetsRouter({db,config}) {
  const router = Router();
  router.use((_request,response,next)=>{response.set('Cache-Control','no-store');next();});
  router.get('/',async(request,response)=>{
    const current = currentBudgetMonth();
    const month = request.query.month ?? current;
    if (!isBudgetMonth(month)) throw invalid('Chọn tháng hợp lệ từ năm 1900.');
    const data = await db.transaction(async tx=>{
      const userId = request.authUser.id;
      await lockBudgetOwner(tx,userId);
      await reconcileBudgets(tx,userId,current);
      return getBudgetPeriod(tx,userId,month);
    });
    reply(response,200,'BUDGETS_LIST','Ngân sách theo tháng.',data);
  });
  router.post('/',csrfGuard(config),async(request,response)=>{
    const {categoryId,baseAmount,month,threshold=80,autoRenew=false} = request.body || {};
    if (!isFinanceId(categoryId)) throw invalid('Chọn danh mục chi hợp lệ.');
    if (!isVnd(baseAmount) || baseAmount==='0') throw invalid('Hạn mức gốc phải là số nguyên VND lớn hơn 0.');
    if (!isBudgetMonth(month)) throw invalid('Chọn tháng hợp lệ từ năm 1900.');
    if (!Number.isInteger(threshold) || threshold<1 || threshold>100) throw invalid('Ngưỡng cảnh báo phải từ 1% đến 100%.');
    if (typeof autoRenew!=='boolean') throw invalid('Tùy chọn tự động gia hạn không hợp lệ.');
    const userId = request.authUser.id;
    const current = currentBudgetMonth();
    let data;
    try {
      data = await db.transaction(async tx=>{
        await lockBudgetOwner(tx,userId);
        const [category] = await tx.execute("SELECT id FROM finance_categories WHERE user_id=? AND id=? AND kind='expense' AND hidden_at IS NULL",[userId,categoryId]);
        if (!category) throw invalid('Chọn danh mục chi thuộc tài khoản của bạn.');
        await tx.execute(`INSERT INTO finance_budgets(user_id,category_id,period,base_amount,threshold,auto_renew)
          VALUES (?,?,?,?,?,?)`,[userId,categoryId,month+'-01',baseAmount,threshold,Number(autoRenew)]);
        await reconcileBudgets(tx,userId,current);
        return getBudgetPeriod(tx,userId,month);
      });
    } catch (error) {
      if (error.code==='ER_DUP_ENTRY') throw new ApiError(409,'BUDGET_EXISTS','Danh mục này đã có ngân sách trong tháng đã chọn.');
      throw error;
    }
    reply(response,201,'BUDGET_SAVED','Đã tạo ngân sách.',data);
  });
  return router;
}
