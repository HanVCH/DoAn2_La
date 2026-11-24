import { localFinanceDate, validateTransaction } from './transaction-policy.mjs';
import { financeForm, setFieldValue } from './finance-fields.js';
import { element, financeCategoryIcon, financeDate, financeRequest, financeTime, kindLabel, notifyFinanceChanged, onFinanceSession, vnd } from './finance-api.js';

const byId = id => document.getElementById(id);
const filter = byId('tx-filter');
const editor = byId('tx-editor'), form = byId('tx-form');
const detail = byId('tx-detail'), confirm = byId('tx-confirm'), references = byId('tx-reference');
const referenceForm = byId('tx-reference-form');
const categoryDialog = byId('tx-category-dialog'), categoryForm = byId('tx-category-form');
const advanced = byId('tx-advanced'), filterToggle = byId('tx-filter-toggle');
const api = '/api/transactions';
let options = { wallets:[], archivedWallets:[], categories:[] };
let query = new URLSearchParams(), page = 1, pages = 1;
let selected = null, editing = null, listRequest = 0, detailRequest = 0;
let openAfterSetup = false;
let categoryTarget = null;

function message(node,text) {
  node.textContent = text;
  node.hidden = !text;
}
function buttons(dialog, locked) {
  for (const button of dialog.querySelectorAll('button')) button.disabled = locked;
  dialog.dataset.busy = String(locked);
}
function fillOptions(select, items, prompt, preferred = select.value) {
  select.replaceChildren(new Option(prompt,''), ...items.map(item=>new Option(item.name,item.id)));
  if (items.some(item=>item.id===preferred)) select.value = preferred;
}
function refreshCategories(fields, prompt, preferred) {
  const kind = fields.kind.value;
  const categories = options.categories.filter(item=>(!kind || item.kind===kind) && (fields===filter.elements || !item.hiddenAt || item.id===editing?.categoryId));
  fillOptions(fields.categoryId,categories.map(item=>item.hiddenAt ? {...item,name:`${item.name} (đã ẩn)`} : item),prompt,preferred);
  updateCategoryPreview(fields.categoryId);
}
function updateCategoryPreview(select) {
  const preview = select.parentElement.querySelector('[data-category-preview]');
  const category = options.categories.find(item=>item.id===select.value);
  preview.replaceChildren(...(category ? [financeCategoryIcon(category.icon,category.kind,category.name,category.color)] : []));
  preview.hidden = !category;
}
for (const fields of [filter.elements,form.elements]) {
  fields.categoryId.addEventListener('change',()=>updateCategoryPreview(fields.categoryId));
}
async function loadOptions() {
  options = await financeRequest(api+'/options');
  const archived = options.archivedWallets.map(wallet=>({...wallet,name:`${wallet.name} (đã lưu trữ)`}));
  fillOptions(filter.elements.walletId,[...options.wallets,...archived],'Tất cả');
  refreshCategories(filter.elements,'Tất cả');
}
function renderItems(items) {
  byId('tx-items').replaceChildren(...items.map(item=>{
    const row = element('li');
    row.dataset.kind = item.kind;
    const description = item.note || item.category;
    const info = element('span',undefined,'tx-row-info');
    const metadata = [financeDate(item.date),item.wallet];
    if (item.note) metadata.push(item.category);
    info.append(element('strong',description),element('small',metadata.join(' · ')));
    const amount = element('strong',`${item.kind==='income'?'+':'−'}${vnd(item.amount)}`,'tx-row-amount');
    const icon = element('span',undefined,'tx-row-icon');
    icon.append(financeCategoryIcon(item.categoryIcon,item.kind,item.category,item.categoryColor));
    const more = element('span','›','tx-row-more');
    icon.setAttribute('aria-hidden','true');
    more.setAttribute('aria-hidden','true');
    const open = element('button',undefined,'tx-row');
    open.type='button';
    open.setAttribute('aria-label',`Xem chi tiết: ${description}, ${kindLabel(item.kind)} ${vnd(item.amount)}`);
    open.append(icon,info,amount,more);
    open.addEventListener('click',()=>showDetail(item.id));
    row.append(open);
    return row;
  }));
}
async function loadList(matchId) {
  const requestId = ++listRequest;
  const parameters = new URLSearchParams(query);
  parameters.set('page',String(page));
  if (matchId) parameters.set('matchId',matchId);
  message(byId('tx-cycle-note'),'');
  message(byId('tx-state'),'Đang tải giao dịch…');
  byId('tx-items').setAttribute('aria-busy','true');
  message(byId('tx-error'),'');
  byId('tx-pagination').hidden = true;
  try {
    const result = await financeRequest(api+'?'+parameters);
    if (requestId!==listRequest) return;
    page=result.page; pages=result.pages;
    if (result.cycle) message(byId('tx-cycle-note'),`Kỳ tài chính ${financeDate(result.cycle.from)} – ${financeDate(result.cycle.through)}`);
    byId('tx-count').textContent = `${result.total} giao dịch`;
    renderItems(result.items);
    const filtered = [...query.keys()].some(key=>key!=='sort');
    const empty = filtered ? 'Không có giao dịch phù hợp với bộ lọc.' : 'Chưa có giao dịch. Hãy thêm giao dịch đầu tiên.';
    message(byId('tx-state'),result.total ? '' : empty);
    byId('tx-page').textContent = `Trang ${page}/${pages}`;
    byId('tx-prev').disabled = page<=1;
    byId('tx-next').disabled = page>=pages;
    byId('tx-pagination').hidden = !result.total;
    if (matchId && !result.matchesFilter) message(byId('tx-notice'),'Đã lưu giao dịch. Giao dịch nằm ngoài bộ lọc hiện tại.');
  } catch (error) {
    if (requestId!==listRequest) return;
    renderItems([]);
    byId('tx-count').textContent = '';
    message(byId('tx-state'),'');
    message(byId('tx-error'),error.message || 'Chưa thể tải giao dịch. Hãy áp dụng lại bộ lọc.');
  } finally {
    if (requestId===listRequest) byId('tx-items').removeAttribute('aria-busy');
  }
}
const changeFields = {
  kind:['Loại',kindLabel], amount:['Số tiền',vnd], date:['Ngày',financeDate],
  wallet:['Ví',String], category:['Danh mục',String], note:['Ghi chú',value=>value || 'Không có'],
};
async function showDetail(id) {
  const current = ++detailRequest;
  const content = byId('tx-detail-data');
  selected=null;
  byId('tx-edit').hidden=true; byId('tx-delete').hidden=true;
  content.replaceChildren(element('p','Đang tải chi tiết…'));
  detail.showModal();
  try {
    const [item, history] = await Promise.all([financeRequest(api+'/'+id),financeRequest(api+'/'+id+'/history')]);
    if (current!==detailRequest) return;
    selected=item;
    const list = element('ul',undefined,'finance-history');
    for (const entry of history) {
      const row = element('li');
      const action = {create:'Thêm',update:'Sửa',delete:'Xóa'}[entry.action];
      row.append(element('strong',`${action} · ${financeTime(entry.changedAt)}`));
      const changes = [];
      for (const [key,[label,format]] of Object.entries(changeFields)) {
        const before=entry.beforeState?.[key], after=entry.afterState?.[key];
        if (entry.action==='update' && before!==after) changes.push(`${label}: ${format(before)} → ${format(after)}`);
        if (entry.action!=='update') changes.push(`${label}: ${format(after ?? before)}`);
      }
      row.append(element('p',changes.length ? changes.join(' · ') : 'Nội dung giao dịch giữ nguyên.'));
      list.append(row);
    }
    const summary = element('div',undefined,'tx-detail-summary');
    const total = element('strong');
    total.append(financeCategoryIcon(item.categoryIcon,item.kind,item.category,item.categoryColor),document.createTextNode(`${kindLabel(item.kind)} · ${vnd(item.amount)}`));
    summary.append(
      total,
      element('p',`${financeDate(item.date)} · ${item.wallet} · ${item.category}${item.deletedAt?' · Đã xóa':''}`),
    );
    if (item.note) summary.append(element('p',item.note));
    content.replaceChildren(summary,element('h3','Lịch sử thay đổi'),list);
    byId('tx-edit').hidden=Boolean(item.deletedAt);
    byId('tx-delete').hidden=Boolean(item.deletedAt);
  } catch (error) {
    if (current===detailRequest) content.replaceChildren(element('p',error.message,'finance-error'));
  }
}

function openEditor(item) {
  const existingArchived = options.archivedWallets.find(wallet=>wallet.id===item?.walletId);
  const wallets = existingArchived ? [...options.wallets,{...existingArchived,name:`${existingArchived.name} (đã lưu trữ)`}] : options.wallets;
  if (!wallets.length || !options.categories.some(category=>!category.hiddenAt || category.id===item?.categoryId)) {
    openAfterSetup = !item;
    message(referenceForm.querySelector('.finance-error'),'');
    references.showModal();
    return;
  }
  editing=item;
  form.reset();
  showFieldErrors({});
  form.elements.kind.value=item?.kind || (options.categories.some(category=>category.kind==='expense' && !category.hiddenAt)?'expense':'income');
  refreshCategories(form.elements,'Chọn danh mục',item?.categoryId || '');
  fillOptions(form.elements.walletId,wallets,'Chọn ví',item?.walletId || (wallets.length===1 ? wallets[0].id : ''));
  setFieldValue(form.elements.date,item?.date || localFinanceDate());
  setFieldValue(form.elements.amount,item?.amount || '');
  form.elements.note.value=item?.note || '';
  byId('tx-editor-title').textContent=item?'Sửa giao dịch':'Thêm giao dịch';
  message(form.querySelector('[role="alert"]'),'');
  editor.showModal();
}

function showFieldErrors(errors, focus = false) {
  for (const [name,fieldError] of Object.entries(changeFieldsForForm)) {
    const input = form.elements[name];
    const error = errors[name] || '';
    message(fieldError,error);
    if (error) input.setAttribute('aria-invalid','true');
    else input.removeAttribute('aria-invalid');
  }
  const firstError = Object.keys(errors)[0];
  if (focus && firstError) {
    if (firstError==='kind') form.querySelector('[name="kind"]').focus();
    else form.elements[firstError]?.focus();
  }
}
const changeFieldsForForm = Object.fromEntries(['amount','categoryId','walletId','date','note'].map(name=>[name,byId('tx-field-'+name)]));

async function mutate(dialog,work,onSuccess) {
  if (dialog.dataset.busy==='true') return;
  const errorNode = dialog.querySelector('[role="alert"]');
  const submit = dialog.querySelector('button[type="submit"]');
  const submitLabel = submit?.textContent;
  message(errorNode,'');
  buttons(dialog,true);
  if (submit) submit.textContent = 'Đang lưu…';
  let data;
  try { data = await work(); }
  catch (error) {
    if (dialog===editor && error.fields) {
      showFieldErrors(error.fields,true);
      message(errorNode,error.message);
    } else message(errorNode,error.fields ? Object.values(error.fields).join(' ') : error.message);
    return;
  } finally {
    buttons(dialog,false);
    if (submit) submit.textContent = submitLabel;
  }
  dialog.close();
  await onSuccess(data);
}
form.addEventListener('submit',event=>{
  event.preventDefault();
  const data = Object.fromEntries(financeForm(form));
  const errors = validateTransaction(data);
  showFieldErrors(errors,true);
  if (Object.keys(errors).length) {
    message(form.querySelector('[role="alert"]'),'Hãy kiểm tra các trường được đánh dấu.');
    return;
  }
  if (editing) data.revision=editing.revision;
  mutate(editor,()=>financeRequest(editing?api+'/'+editing.id:api,editing?'PUT':'POST',data),async item=>{
    message(byId('tx-notice'),'Đã lưu giao dịch.');
    notifyFinanceChanged();
    await loadList(item.id);
  });
});
byId('tx-delete-form').addEventListener('submit',event=>{
  event.preventDefault();
  mutate(confirm,()=>financeRequest(api+'/'+selected.id,'DELETE',{revision:selected.revision}),async ()=>{
    message(byId('tx-notice'),'Đã xóa giao dịch. Bạn vẫn có thể xem lịch sử trong mục Đã xóa.');
    notifyFinanceChanged();
    await loadList();
  });
});
function saveOption(data) {
  mutate(references,()=>financeRequest(api+'/options','POST',data),async ()=>{
    try {
      await loadOptions();
      notifyFinanceChanged();
      message(byId('tx-notice'),'Đã cập nhật ví và danh mục.');
      if (openAfterSetup && options.wallets.length && options.categories.length) {
        openAfterSetup = false;
        openEditor(null);
      }
    } catch (error) { message(byId('tx-error'),error.message); }
  });
}
referenceForm.addEventListener('submit',event=>{event.preventDefault();saveOption(Object.fromEntries(new FormData(referenceForm)));});
referenceForm.elements.resource.addEventListener('change',()=>{
  const isWallet = referenceForm.elements.resource.value==='wallet';
  byId('tx-reference-kind').hidden = isWallet;
  referenceForm.querySelector('.category-icon-picker').hidden = isWallet;
});
byId('tx-starter').addEventListener('click',()=>saveOption({resource:'starter'}));
byId('tx-add').addEventListener('click',()=>openEditor(null));
byId('tx-options').addEventListener('click',()=>{
  openAfterSetup = false;
  message(referenceForm.querySelector('.finance-error'),'');
  references.showModal();
});
function openCategoryDialog(target) {
  categoryTarget = target;
  categoryForm.reset();
  const kind = target.elements.kind.value;
  categoryForm.elements.kind.value = kind || 'expense';
  categoryForm.elements.kind.disabled = Boolean(kind);
  message(categoryForm.querySelector('[role="alert"]'),'');
  categoryDialog.showModal();
}
byId('tx-editor-new-category').addEventListener('click',()=>openCategoryDialog(form));
byId('tx-filter-new-category').addEventListener('click',()=>openCategoryDialog(filter));
categoryForm.addEventListener('submit',event=>{
  event.preventDefault();
  const name = categoryForm.elements.name.value.trim();
  if (!name) {
    message(categoryForm.querySelector('[role="alert"]'),'Vui lòng nhập tên danh mục.');
    categoryForm.elements.name.focus();
    return;
  }
  const target = categoryTarget;
  const data = {resource:'category',name,kind:categoryForm.elements.kind.value,icon:categoryForm.elements.icon.value};
  mutate(categoryDialog,()=>financeRequest(api+'/options','POST',data),category=>{
    options.categories.push(category);
    options.categories.sort((a,b)=>a.name.localeCompare(b.name,'vi'));
    refreshCategories(filter.elements,'Tất cả',target===filter ? category.id : undefined);
    if (target===form) {
      refreshCategories(form.elements,'Chọn danh mục',category.id);
      message(byId('tx-field-categoryId'),'');
      form.elements.categoryId.removeAttribute('aria-invalid');
    }
    target.elements.categoryId.focus();
  });
});
byId('tx-edit').addEventListener('click',()=>{detail.close();openEditor(selected);});
byId('tx-delete').addEventListener('click',()=>{
  detail.close();
  message(confirm.querySelector('.finance-error'),'');
  byId('tx-delete-description').textContent=`Xóa giao dịch “${selected.note || selected.category}” với số tiền ${vnd(selected.amount)}?`;
  confirm.showModal();
});
for (const dialog of [editor,detail,confirm,references,categoryDialog]) {
  dialog.querySelector('[data-close]').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('cancel',event=>{if(dialog.dataset.busy==='true')event.preventDefault();});
}
form.addEventListener('change',event=>{
  if (event.target.name==='kind') refreshCategories(form.elements,'Chọn danh mục');
});
form.addEventListener('input',event=>{
  const fieldError = changeFieldsForForm[event.target.name];
  if (fieldError) {
    message(fieldError,'');
    event.target.removeAttribute('aria-invalid');
  }
});
filter.elements.kind.addEventListener('change',()=>refreshCategories(filter.elements,'Tất cả'));
function toggleFilters(open) {
  advanced.hidden = !open;
  filterToggle.setAttribute('aria-expanded',String(open));
}
filterToggle.addEventListener('click',()=>toggleFilters(advanced.hidden));
function applyFilters() {
  query = new URLSearchParams([...financeForm(filter)].filter(([,value])=>value!==''));
  const filterCount = [...query.keys()].filter(key=>!['sort','deleted','q'].includes(key)).length;
  message(byId('tx-filter-count'),filterCount ? String(filterCount) : '');
  byId('tx-filter-reset').hidden = !filterCount && !query.has('q') && !query.has('deleted') && query.get('sort')==='newest';
  page=1;
  message(byId('tx-notice'),'');
  loadList();
}
filter.addEventListener('submit',event=>{
  event.preventDefault();
  const closeFilters = event.submitter===byId('tx-apply-advanced');
  if (closeFilters) {
    toggleFilters(false);
    filterToggle.focus();
  }
  applyFilters();
});
function toggleCycleDates() {
  filter.elements.from.disabled = filter.elements.to.disabled = filter.elements.period.checked;
}
filter.elements.period.addEventListener('change',toggleCycleDates);
filter.addEventListener('reset',()=>setTimeout(()=>{toggleCycleDates();refreshCategories(filter.elements,'Tất cả','');applyFilters();},0));
filter.elements.sort.addEventListener('change',applyFilters);
filter.elements.deleted.addEventListener('change',applyFilters);
byId('tx-prev').addEventListener('click',()=>{if(page>1){page--;loadList();}});
byId('tx-next').addEventListener('click',()=>{if(page<pages){page++;loadList();}});
onFinanceSession(()=>{
  loadOptions().catch(error=>message(byId('tx-error'),error.message));
  loadList();
});
