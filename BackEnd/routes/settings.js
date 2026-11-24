import { Router } from 'express';
import { sessionCookieOptions } from '../middleware/auth.js';
import { ApiError, reply } from '../middleware/errors.js';
import { accountLimit, createRateLimiter, csrfGuard } from '../middleware/security.js';
import { lockBudgetOwner } from '../services/budgets.js';
import { listCategories, resetCategories, saveCategory, seedCategories } from '../services/categories.js';
import { getOnboardingState } from '../services/onboarding.js';
import { hashPassword, verifyPassword } from '../services/passwords.js';
import { defaultPreferences, readPreferences } from '../services/preferences.js';
import { passwordInput } from '../validators/auth.js';

async function readSettings(db,user) {
  const [preferences,categories,profile] = await Promise.all([readPreferences(db,user),listCategories(db,user),getOnboardingState(db,user)]);
  const {full_name,birth_date,hometown,monthly_income,usage_purpose,usage_purpose_note} = profile;
  return {preferences,categories,profile:{fullName:full_name,birthDate:birth_date,hometown,monthlyIncome:monthly_income,
    usagePurpose:usage_purpose,usagePurposeNote:usage_purpose_note}};
}

const backupTables = {
  categories:['finance_categories','id,kind,name,icon,color,hidden_at,default_key'],
  wallets:['finance_wallets','id,name,kind,opening_amount,credit_limit,payment_due,note,archived_at'],
  transactions:['finance_transactions','id,kind,amount,wallet_id,category_id,transaction_date,note,revision,deleted_at'],
  transactionHistory:['finance_transaction_history','id,transaction_id,action,before_state,after_state,changed_at'],
  walletMovements:['finance_wallet_movements','id,wallet_id,related_wallet_id,operation_key AS movement_group,kind,delta,movement_date,note,created_at'],
  budgets:['finance_budgets','id,category_id,period,base_amount,carry_amount,threshold,auto_renew'],
  goals:['finance_goals','id,name,target_amount,saved_amount,due_date,note,deleted_at'],
  profile:['user_profiles','full_name,birth_date,hometown,monthly_income,usage_purpose,usage_purpose_note'],
};

export function createSettingsRouter({db,config}) {
  const router = Router(), limiter = createRateLimiter();
  router.use((request,response,next)=>{
    response.set('Cache-Control','no-store');
    return request.method==='GET' ? next() : csrfGuard(config)(request,response,next);
  });
  function write(user,work) {
    return db.transaction(async tx=>{
      await lockBudgetOwner(tx,user);
      return work(tx);
    });
  }

  router.get('/',async(request,response)=>{
    reply(response,200,'SETTINGS','Cài đặt tài khoản.',await readSettings(db,request.authUser.id));
  });
  router.put('/preferences',async(request,response)=>{
    const {numberStyle,cycleStartDay,currency='VND'} = request.body || {};
    if (!['dots','commas'].includes(numberStyle) || !Number.isInteger(cycleStartDay) || cycleStartDay<1 || cycleStartDay>31) {
      throw new ApiError(400,'SETTINGS_INVALID','Chọn định dạng số và ngày bắt đầu từ 1 đến 31.');
    }
    if (currency!=='VND') throw new ApiError(400,'CURRENCY_UNAVAILABLE','LÁ hiện hiển thị VND vì chưa có nguồn tỷ giá quy đổi.');
    const user = request.authUser.id;
    await write(user,tx=>tx.execute(`INSERT INTO user_finance_settings(user_id,number_style,cycle_start_day) VALUES (?,?,?)
      ON DUPLICATE KEY UPDATE number_style=VALUES(number_style),cycle_start_day=VALUES(cycle_start_day)`,[user,numberStyle,cycleStartDay]));
    reply(response,200,'PREFERENCES_SAVED','Đã lưu tùy chọn hiển thị.',{currency,numberStyle,cycleStartDay});
  });

  async function category(request,response) {
    const user = request.authUser.id, id = request.params.id;
    const saved = await write(user,tx=>saveCategory(tx,user,request.body || {},id));
    reply(response,id ? 200 : 201,'CATEGORY_SAVED','Đã lưu danh mục.',saved);
  }
  router.post('/categories',category);
  router.put('/categories/:id',category);
  router.post('/default-categories',async(request,response)=>{
    const user = request.authUser.id;
    await write(user,tx=>seedCategories(tx,user));
    reply(response,200,'CATEGORY_DEFAULTS_ADDED','Đã thêm danh mục mặc định.',await listCategories(db,user));
  });

  router.post('/restore-defaults',async(request,response)=>{
    if (request.body?.confirm!==true) throw new ApiError(400,'CONFIRM_DEFAULTS','Vui lòng xác nhận đặt lại cài đặt.');
    const user = request.authUser.id;
    await write(user,async tx=>{
      await resetCategories(tx,user);
      await tx.execute('DELETE FROM user_finance_settings WHERE user_id=?',[user]);
    });
    reply(response,200,'SETTINGS_RESTORED','Đã khôi phục cài đặt mặc định.',{preferences:defaultPreferences,categories:await listCategories(db,user)});
  });

  router.post('/password',limiter.middleware('change-password',20,15*60000),async(request,response)=>{
    const user = request.authUser.id, session = request.authUser.session_id;
    const {currentPassword,password,confirmPassword} = request.body || {};
    accountLimit(limiter,response,`password-account:${user}`,12,15*60000);
    passwordInput(password,confirmPassword);
    const [previous] = await db.execute(`SELECT u.password_hash,u.auth_version FROM users u JOIN auth_sessions s ON s.user_id=u.id
      WHERE u.id=? AND s.id=? AND s.revoked_at IS NULL AND s.expires_at>UTC_TIMESTAMP(6) AND s.auth_version=u.auth_version`,[user,session]);
    if (previous?.password_hash===null) throw new ApiError(409,'PASSWORD_NOT_SET','Tài khoản chưa có mật khẩu. Hãy dùng phương thức đăng nhập đã liên kết.');
    if (!previous || !await verifyPassword(currentPassword,previous.password_hash)) throw new ApiError(400,'CURRENT_PASSWORD_INVALID','Mật khẩu hiện tại chưa đúng.');
    const encoded = await hashPassword(password);
    await write(user,async tx=>{
      const updated = await tx.execute(`UPDATE users SET password_hash=?,password_changed_at=UTC_TIMESTAMP(6),
        auth_version=auth_version+1,updated_at=UTC_TIMESTAMP(6)
        WHERE id=? AND auth_version=? AND password_hash=? AND status='active'
        AND EXISTS(SELECT 1 FROM auth_sessions WHERE user_id=? AND id=? AND revoked_at IS NULL AND expires_at>UTC_TIMESTAMP(6))`,
      [encoded,user,previous.auth_version,previous.password_hash,user,session]);
      if (!updated.affectedRows) throw new ApiError(409,'PASSWORD_CHANGED','Phiên hoặc mật khẩu đã thay đổi. Hãy đăng nhập lại.');
      await tx.execute('UPDATE auth_sessions SET revoked_at=UTC_TIMESTAMP(6) WHERE user_id=? AND revoked_at IS NULL',[user]);
      await tx.execute('UPDATE password_reset_tokens SET revoked_at=UTC_TIMESTAMP(6) WHERE user_id=? AND used_at IS NULL AND revoked_at IS NULL',[user]);
    });
    response.clearCookie('la_session',sessionCookieOptions(config));
    reply(response,200,'PASSWORD_CHANGED','Đã đổi mật khẩu. Vui lòng đăng nhập lại.',null,'/login?notice=password-reset');
  });

  router.get('/backup',async(request,response)=>{
    const user = request.authUser.id;
    const data = await db.transaction(async tx=>{
      const sections = await Promise.all(Object.entries(backupTables).map(async ([key,[table,columns]])=>[
        key,await tx.execute(`SELECT ${columns} FROM ${table} WHERE user_id=?`,[user]),
      ]));
      return {...Object.fromEntries(sections),preferences:await readPreferences(tx,user)};
    });
    const exportedAt = new Date().toISOString();
    response.attachment(`la-sao-luu-${exportedAt.slice(0,10)}.json`).json({version:1,exportedAt,data});
  });
  return router;
}
