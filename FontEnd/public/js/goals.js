import { isFinanceDate, isVnd } from './transaction-policy.mjs';
import { fieldValue, financeForm, setFieldValue } from './finance-fields.js';
import { financeRequest, notifyFinanceChanged, onFinanceSession, vnd } from './finance-api.js';
import { renderGoals } from './goals-ui.js';

const byId = id=>document.getElementById(id);
const dialog = byId('goal-dialog'), form = byId('goal-form');
const details = byId('goal-details'), savings = byId('goal-savings'), deleteText = byId('goal-delete-text');
const status = byId('goals-state'), empty = byId('goals-empty'), retry = byId('goals-retry');
const error = byId('goal-error'), cancel = byId('goal-cancel'), add = byId('goal-add');
const save = form.querySelector('button[type="submit"]');
const {day,month,year,amount} = form.elements;
const clearDate = byId('goal-date-clear');
const titles = {create:'Tạo hũ chi tiêu',edit:'Sửa hũ chi tiêu',savings:'Thêm tiền vào hũ',remove:'Xóa hũ chi tiêu'};
let mode, currentId, saving = false, loadId = 0;
let currentSavings = '0';

function refreshDateFields() {
  const selectedYear = Number(year.value) || 2000;
  const days = month.value ? new Date(Date.UTC(selectedYear,Number(month.value),0)).getUTCDate() : 31;
  for (const option of day.options) option.disabled = Number(option.value)>days;
  if (Number(day.value)>days) day.value = '';
  clearDate.hidden = !(day.value || month.value || year.value || year.validity.badInput);
}

function setDate(date='') {
  const [yy='',mm='',dd=''] = date.split('-');
  year.value = yy;
  month.value = mm;
  day.value = dd;
  refreshDateFields();
}

function previewSavings() {
  const value = fieldValue(amount);
  const total = isVnd(value) ? (BigInt(currentSavings)+BigInt(value)).toString() : null;
  byId('goal-saved-next').textContent = isVnd(total) ? vnd(total) : '—';
}

function open(action,goal) {
  mode = action;
  currentId = goal?.id;
  const editingDetails = action==='create' || action==='edit';
  details.hidden = details.disabled = !editingDetails;
  savings.hidden = savings.disabled = action!=='savings';
  deleteText.hidden = action!=='remove';
  if (action==='remove') deleteText.textContent = `Bạn có muốn xóa hũ “${goal.name}”?`;
  for (const field of ['name','targetAmount','note']) setFieldValue(form.elements[field],goal?.[field] ?? '');
  setDate(goal?.dueDate ?? '');
  if (action==='savings') {
    amount.value = '';
    currentSavings = goal.savedAmount;
    byId('goal-savings-name').textContent = goal.name;
    byId('goal-saved-current').textContent = vnd(currentSavings);
    previewSavings();
  }
  byId('goal-title').textContent = titles[action];
  save.textContent = action==='remove' ? 'Xóa hũ' : action==='savings' ? 'Thêm tiền' : 'Lưu hũ chi tiêu';
  error.hidden = true;
  dialog.showModal();
  if (action==='remove') cancel.focus();
}

const actions = Object.fromEntries(['edit','savings','remove'].map(action=>[action,goal=>open(action,goal)]));

async function load() {
  const request = ++loadId;
  status.textContent = 'Đang tải hũ chi tiêu…';
  status.hidden = false;
  empty.hidden = retry.hidden = true;
  try {
    const goals = await financeRequest('/api/goals');
    if (request!==loadId) return;
    renderGoals(byId('goals-items'),goals,actions);
    status.hidden = true;
    empty.hidden = goals.length>0;
  } catch (failure) {
    if (request!==loadId) return;
    status.textContent = failure.message;
    retry.hidden = false;
  }
}

function invalid(field,message) {
  error.textContent = message;
  error.hidden = false;
  form.elements[field].focus();
}

add.addEventListener('click',()=>open('create'));
byId('goal-first').addEventListener('click',()=>open('create'));
retry.addEventListener('click',()=>load());
cancel.addEventListener('click',()=>dialog.close());
dialog.addEventListener('cancel',event=>{if (saving) event.preventDefault();});
day.addEventListener('change',refreshDateFields);
month.addEventListener('change',refreshDateFields);
year.addEventListener('input',refreshDateFields);
clearDate.addEventListener('click',()=>{setDate();day.focus();});
amount.addEventListener('input',previewSavings);
form.addEventListener('submit',async event=>{
  event.preventDefault();
  if (saving) return;
  const data = Object.fromEntries(financeForm(form));
  if (mode==='create' || mode==='edit') {
    data.name = data.name.trim();
    if (!data.name) return invalid('name','Nhập tên hũ chi tiêu.');
    if (!isVnd(data.targetAmount) || data.targetAmount==='0') return invalid('targetAmount','Nhập số tiền mục tiêu bằng số nguyên VND lớn hơn 0.');
    data.dueDate = null;
    if (data.day || data.month || data.year) {
      const missing = ['day','month','year'].find(part=>!data[part]);
      if (missing) return invalid(missing,'Chọn đủ ngày, tháng và năm hoặc bấm Xóa ngày.');
      data.dueDate = `${data.year}-${data.month}-${data.day}`;
      if (!isFinanceDate(data.dueDate)) return invalid('day','Ngày dự kiến hoàn thành không hợp lệ.');
    }
    delete data.day;
    delete data.month;
    delete data.year;
  }
  if (mode==='savings' && (!isVnd(data.amount) || data.amount==='0')) return invalid('amount','Nhập số tiền thêm bằng số nguyên VND lớn hơn 0.');

  const base = '/api/goals';
  const url = mode==='create' ? base : `${base}/${currentId}${mode==='savings' ? '/savings' : ''}`;
  const method = {create:'POST',edit:'PUT',savings:'POST',remove:'DELETE'}[mode];
  const saveLabel = save.textContent;
  saving = true;
  error.hidden = true;
  save.disabled = cancel.disabled = true;
  save.textContent = mode==='remove' ? 'Đang xóa…' : 'Đang lưu…';
  try {
    await financeRequest(url,method,mode==='remove' ? undefined : data);
    dialog.close();
    add.focus();
    notifyFinanceChanged();
    load();
  } catch (failure) {
    error.textContent = failure.message;
    error.hidden = false;
  } finally {
    saving = false;
    save.disabled = cancel.disabled = false;
    save.textContent = saveLabel;
  }
});
onFinanceSession(load);
