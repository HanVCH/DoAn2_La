export const purposes = {
  track_expenses: 'Theo dõi thu chi', save_money: 'Tiết kiệm', control_budget: 'Kiểm soát ngân sách', repay_debt: 'Trả nợ', other: 'Khác',
};
export function birthDateError(value, today = new Date()) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'Vui lòng nhập ngày sinh theo định dạng ngày/tháng/năm.';
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0,10) !== value) return 'Ngày sinh không có thật.';
  const current = today.toISOString().slice(0,10);
  const oldest = new Date(Date.UTC(today.getUTCFullYear() - 120, today.getUTCMonth(), today.getUTCDate()));
  if (oldest.getUTCMonth() !== today.getUTCMonth()) oldest.setUTCDate(0);
  if (value > current || value < oldest.toISOString().slice(0,10)) return 'Ngày sinh phải trong 120 năm gần đây và không ở tương lai.';
  return '';
}
export function ageFromBirthDate(value, today = new Date()) {
  if (birthDateError(value, today)) return null;
  const [year, month, day] = value.split('-').map(Number);
  return today.getUTCFullYear() - year - (today.getUTCMonth() + 1 < month || (today.getUTCMonth() + 1 === month && today.getUTCDate() < day) ? 1 : 0);
}
export function profileInput(body, today = new Date()) {
  const errors = {};
  const text = (name, max, required = true) => {
    const value = typeof body[name] === 'string' ? body[name].trim() : '';
    if ((required && !value) || [...value].length > max || /[\u0000-\u001f\u007f]/.test(value)) errors[name] = `Vui lòng nhập ${name === 'fullName' ? 'họ tên' : name === 'hometown' ? 'quê quán' : 'mô tả mục đích'} hợp lệ, tối đa ${max} ký tự.`;
    return value;
  };
  const fullName = text('fullName',100), hometown = text('hometown',150);
  const birthDate = body.birthDate;
  const birthError = birthDateError(birthDate,today);
  if (birthError) errors.birthDate = birthError;
  const monthlyIncome = typeof body.monthlyIncome === 'string' ? body.monthlyIncome.trim() : '';
  if (!/^(?:0|[1-9]\d{0,12})(?:\.\d{1,2})?$/.test(monthlyIncome)) errors.monthlyIncome = 'Nhập thu nhập VND không âm, tối đa 13 chữ số và 2 số thập phân; có thể nhập 0.';
  const usagePurpose = body.usagePurpose;
  if (!Object.hasOwn(purposes, usagePurpose ?? '')) errors.usagePurpose = 'Vui lòng chọn mục đích sử dụng.';
  const usagePurposeNote = text('usagePurposeNote',255,usagePurpose === 'other');
  return { errors, value: { fullName,birthDate,hometown,monthlyIncome,usagePurpose,usagePurposeNote: usagePurpose === 'other' ? usagePurposeNote : null } };
}
