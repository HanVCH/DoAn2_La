import { ApiError } from '../middleware/errors.js';
import { isCategoryIcon } from '../../shared/category-icons.mjs';
import { financeKinds, isFinanceId } from '../../shared/transaction-policy.mjs';

export const defaultCategories = [
  {key:'salary',kind:'income',name:'Lương',icon:'cash'},
  {key:'other-income',kind:'income',name:'Thu khác',icon:'cash'},
  {key:'food',kind:'expense',name:'Ăn uống',icon:'noodles'},
  {key:'travel',kind:'expense',name:'Đi lại',icon:'scooter'},
  {key:'other-expense',kind:'expense',name:'Chi khác',icon:'tag'},
];

const fields = 'id,kind,name,icon,color,hidden_at AS hiddenAt,default_key AS defaultKey';
export const listCategories = (db,user)=>db.execute(`SELECT ${fields} FROM finance_categories WHERE user_id=? ORDER BY name,id`,[user]);

export async function seedCategories(db,user) {
  const values = defaultCategories.flatMap(({key,kind,name,icon})=>[user,key,kind,name,icon]);
  await db.execute(`INSERT INTO finance_categories(user_id,default_key,kind,name,icon) VALUES
    ${defaultCategories.map(()=>'(?,?,?,?,?)').join(',')} ON DUPLICATE KEY UPDATE id=id`,values);
}

export async function resetCategories(db,user) {
  for (const {key,name,icon} of defaultCategories) {
    await db.execute('UPDATE finance_categories SET name=?,icon=?,color=NULL,hidden_at=NULL WHERE user_id=? AND default_key=?',[name,icon,user,key]);
  }
  await seedCategories(db,user);
}

export async function saveCategory(db,user,data,id) {
  const {name,icon=null,color=null,hidden=false} = data;
  if (typeof name!=='string' || !name.trim() || name.trim().length>80 || /[\u0000-\u001f\u007f]/.test(name)) throw new ApiError(400,'CATEGORY_INVALID','Nhập tên danh mục từ 1 đến 80 ký tự.');
  if ((icon!==null && !isCategoryIcon(icon)) || (color!==null && (typeof color!=='string' || !/^#[0-9a-f]{6}$/i.test(color))) || typeof hidden!=='boolean') {
    throw new ApiError(400,'CATEGORY_INVALID','Chọn biểu tượng, màu và trạng thái hợp lệ.');
  }
  let existing;
  if (id) {
    if (isFinanceId(id)) [existing] = await db.execute(`SELECT ${fields} FROM finance_categories WHERE user_id=? AND id=?`,[user,id]);
    if (!existing) throw new ApiError(404,'CATEGORY_NOT_FOUND','Không tìm thấy danh mục.');
  }
  const kind = existing?.kind ?? data.kind;
  if (!financeKinds.includes(kind)) throw new ApiError(400,'CATEGORY_INVALID','Chọn nhóm Thu hoặc Chi.');
  const displayName = name.trim();
  const reserved = defaultCategories.filter(item=>item.kind===kind && item.key!==existing?.defaultKey);
  if (!existing || existing.name!==displayName) {
    const [duplicate] = await db.execute(`SELECT (${reserved.map(()=>
      'CONVERT(? USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(? USING utf8mb4) COLLATE utf8mb4_unicode_ci').join(' OR ')}) AS reserved`,
    reserved.flatMap(item=>[displayName,item.name]));
    if (duplicate.reserved) throw new ApiError(409,'CATEGORY_EXISTS','Tên này đã được sử dụng cho danh mục mặc định trong nhóm.');
  }
  let savedId = id;
  try {
    if (existing) {
      await db.execute(`UPDATE finance_categories SET name=?,icon=?,color=?,hidden_at=IF(?,COALESCE(hidden_at,UTC_TIMESTAMP(6)),NULL)
        WHERE user_id=? AND id=?`,[displayName,icon,color,hidden,user,id]);
    } else {
      await db.execute('INSERT INTO finance_categories(user_id,kind,name,icon,color,hidden_at) VALUES (?,?,?,?,?,IF(?,UTC_TIMESTAMP(6),NULL))',
        [user,kind,displayName,icon,color,hidden]);
      [{id:savedId}] = await db.execute('SELECT CAST(LAST_INSERT_ID() AS CHAR) AS id');
    }
  } catch (error) {
    if (error.code==='ER_DUP_ENTRY') throw new ApiError(409,'CATEGORY_EXISTS','Tên này đã được sử dụng trong nhóm.');
    throw error;
  }
  const [saved] = await db.execute(`SELECT ${fields} FROM finance_categories WHERE user_id=? AND id=?`,[user,savedId]);
  return saved;
}
