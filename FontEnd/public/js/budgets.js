import { isVnd, localFinanceDate } from './transaction-policy.mjs';
import { fieldValue, setFieldValue } from './finance-fields.js';
import { element, financeCategoryIcon, financeRequest, notifyFinanceChanged, onFinanceSession, vnd } from './finance-api.js';

const byId = id=>document.getElementById(id);
const budgetMonth = byId('budget-month'), budgetYear = byId('budget-year'), status = byId('budget-status');
const dialog = byId('budget-dialog'), form = byId('budget-form'), error = byId('budget-form-error');
const save = form.querySelector('[type="submit"]'), add = byId('budget-add'), cancel = byId('budget-cancel');
const labels = {normal:'Bình thường',warning:'Sắp hết ngân sách',exhausted:'Đã dùng hết',over:'Vượt ngân sách'};
let loading = 0, saving = false;

function setPeriod(period) {
  const [year,month] = period.split('-');
  budgetYear.value = year;
  budgetMonth.value = month;
}

function selectedPeriod() {
  return budgetYear.validity.valid ? `${budgetYear.value}-${budgetMonth.value}` : null;
}

function renderBudget(item) {
  const row = element('li',undefined,'app-card budget-card');
  row.dataset.status = item.status;
  const heading = element('div',undefined,'budget-card-heading');
  const title = element('h2');
  title.append(financeCategoryIcon(item.categoryIcon,'expense',item.category,item.categoryColor),document.createTextNode(item.category));
  heading.append(title,element('span',labels[item.status],'budget-badge'));
  const values = element('dl',undefined,'budget-card-values');
  for (const [label,key] of [['Hạn mức gốc','baseAmount'],['Tiền chuyển kỳ','carryAmount'],['Hạn mức khả dụng','available'],['Đã chi','spent'],['Còn lại','remaining']]) {
    const itemValue = element('div');
    itemValue.append(element('dt',label),element('dd',vnd(item[key])));
    values.append(itemValue);
  }
  const progressLabel = element('div',undefined,'budget-progress-label');
  progressLabel.append(element('span','Đã dùng'),element('strong',item.percent.replace('.',',')+'%'));
  const bar = element('progress',undefined,'budget-progress');
  bar.max = 100;
  bar.value = item.progress;
  bar.setAttribute('aria-label',`Đã dùng ${item.percent.replace('.',',')}% ngân sách ${item.category}`);
  row.append(heading,values,progressLabel,bar);
  if (item.status==='over') row.append(element('p',`Vượt ${vnd(item.overage)}`,'budget-exceeded'));
  row.append(element('small',`Cảnh báo ở ${item.threshold}% · ${item.autoRenew?'Tự động gia hạn':'Gia hạn thủ công'}`,'budget-card-meta'));
  return row;
}
function render(data) {
  for (const [key,value] of Object.entries(data.totals)) byId('budget-total-'+key).textContent = vnd(value);
  byId('budget-total-remaining').classList.toggle('budget-exceeded',BigInt(data.totals.remaining)<0n);
  byId('budget-overage-items').replaceChildren(...data.overBudget.map(item=>element('li',`${item.category} · Vượt ${vnd(item.overage)}`)));
  byId('budget-overages').hidden = !data.overBudget.length;
  byId('budget-items').replaceChildren(...data.items.map(renderBudget));
  byId('budget-overview').hidden = false;
  status.textContent = data.items.length ? '' : 'Chưa có ngân sách trong kỳ này. Bạn có thể tạo hạn mức cho một danh mục chi.';
  status.hidden = Boolean(data.items.length);
}
async function load() {
  const period = selectedPeriod();
  if (!period) return;
  const request = ++loading;
  status.hidden = false;
  status.textContent = 'Đang tải ngân sách…';
  byId('budget-overview').hidden = true;
  byId('budget-items').replaceChildren();
  try {
    const data = await financeRequest('/api/budgets?month='+encodeURIComponent(period));
    if (request===loading) render(data);
  } catch (failure) {
    if (request===loading) status.textContent = failure.message;
  }
}
setPeriod(localFinanceDate().slice(0,7));
budgetMonth.addEventListener('change',load);
budgetYear.addEventListener('change',()=>{
  if (budgetYear.reportValidity()) load();
});
onFinanceSession(load);

add.addEventListener('click',async()=>{
  if (!budgetYear.reportValidity()) return;
  add.disabled = true;
  form.reset();
  setFieldValue(form.elements.month,selectedPeriod());
  form.elements.categoryId.replaceChildren(new Option('Đang tải danh mục…',''));
  byId('budget-no-options').hidden = true;
  error.hidden = true;
  save.disabled = true;
  dialog.showModal();
  try {
    const {categories} = await financeRequest('/api/transactions/options');
    const expenses = categories.filter(category=>category.kind==='expense' && !category.hiddenAt);
    form.elements.categoryId.replaceChildren(new Option('Chọn danh mục',''),...expenses.map(category=>new Option(category.name,category.id)));
    byId('budget-no-options').hidden = Boolean(expenses.length);
    save.disabled = !expenses.length;
  } catch (failure) {
    error.textContent = failure.message;
    error.hidden = false;
  } finally { add.disabled = false; }
});
cancel.addEventListener('click',()=>dialog.close());
dialog.addEventListener('cancel',event=>{if (saving) event.preventDefault();});
form.addEventListener('submit',async event=>{
  event.preventDefault();
  if (saving || save.disabled) return;
  const {categoryId,baseAmount,month,threshold,autoRenew} = form.elements;
  const amount = fieldValue(baseAmount).trim();
  if (!isVnd(amount) || amount==='0') {
    error.textContent = 'Nhập hạn mức gốc bằng số nguyên VND lớn hơn 0.';
    error.hidden = false;
    baseAmount.focus();
    return;
  }
  saving = true;
  save.disabled = cancel.disabled = true;
  save.textContent = 'Đang lưu…';
  error.hidden = true;
  try {
    const data = await financeRequest('/api/budgets','POST',{
      categoryId:categoryId.value,baseAmount:amount,month:fieldValue(month),
      threshold:Number(threshold.value),autoRenew:autoRenew.checked,
    });
    setPeriod(data.month);
    ++loading;
    dialog.close();
    render(data);
    notifyFinanceChanged();
  } catch (failure) {
    error.textContent = failure.message;
    error.hidden = false;
  } finally {
    saving = false;
    save.disabled = cancel.disabled = false;
    save.textContent = 'Lưu ngân sách';
  }
});
