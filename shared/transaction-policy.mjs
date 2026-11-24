export const financeZone = 'Asia/Ho_Chi_Minh';
export const financeKinds = ['income', 'expense'];
export const isFinanceId = value => typeof value === 'string' && /^[1-9]\d{0,19}$/.test(value) && BigInt(value) <= 18446744073709551615n;
export const isVnd = value => typeof value === 'string' && /^(?:0|[1-9]\d{0,17})$/.test(value);
export function isFinanceDate(value) {
  if (typeof value !== 'string' || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === value;
}
export function localFinanceDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA',{timeZone:financeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  const values = Object.fromEntries(parts.map(({type,value})=>[type,value]));
  return [values.year,values.month,values.day].join('-');
}
export function financePeriodEnd(month,today=localFinanceDate()) {
  if (today.startsWith(month+'-')) return today;
  const end = new Date(month+'-01T00:00:00Z');
  end.setUTCMonth(end.getUTCMonth()+1,0);
  return end.toISOString().slice(0,10);
}
export function financeMonthOffset(month,offset) {
  const date = new Date(month+'-01T00:00:00Z');
  date.setUTCMonth(date.getUTCMonth()+offset);
  return date.toISOString().slice(0,7);
}
function cycleStart(month,day,offset=0) {
  const date = new Date(month+'-01T00:00:00Z');
  date.setUTCMonth(date.getUTCMonth()+offset+1,0);
  date.setUTCDate(Math.min(day,date.getUTCDate()));
  return date;
}
export function financeCycle(month,day=1,today=localFinanceDate()) {
  const calendarMonth = today.slice(0,7);
  const current = today<cycleStart(calendarMonth,day).toISOString().slice(0,10)
    ? financeMonthOffset(calendarMonth,-1) : calendarMonth;
  const key = month ?? current;
  const from = cycleStart(key,day).toISOString().slice(0,10);
  const end = cycleStart(key,day,1);
  end.setUTCDate(end.getUTCDate()-1);
  const to = end.getUTCFullYear()>9999 ? '9999-12-31' : end.toISOString().slice(0,10);
  return {month:key,from,to,through:key===current ? today : to,isCurrent:key===current};
}
export function validateTransaction(data) {
  const errors = {};
  if (!financeKinds.includes(data.kind)) errors.kind = 'Chọn loại thu hoặc chi.';
  if (!isVnd(data.amount) || data.amount === '0') errors.amount = 'Nhập số tiền VND nguyên dương, tối đa 18 chữ số.';
  if (!isFinanceId(data.categoryId)) errors.categoryId = 'Chọn danh mục.';
  if (!isFinanceId(data.walletId)) errors.walletId = 'Chọn ví.';
  if (!isFinanceDate(data.date)) errors.date = 'Chọn ngày giao dịch hợp lệ.';
  if (data.note !== undefined && (typeof data.note !== 'string' || data.note.length > 500)) errors.note = 'Ghi chú tối đa 500 ký tự.';
  return errors;
}
