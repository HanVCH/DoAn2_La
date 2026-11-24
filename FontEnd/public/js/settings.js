import { profileInput } from './profile-policy.mjs';
import { financeForm, setFieldValue } from './finance-fields.js';
import { financeCycle } from './transaction-policy.mjs';
import { element, financeCategoryIcon, financeDate, financeRequest, formatVnd, notifyFinanceChanged, onFinanceSession, setFinancePreferences } from './finance-api.js';

const api = '/api/settings';
const byId = id=>document.getElementById(id);
const content = byId('settings-content'), retry = byId('settings-retry');
const preferences = byId('settings-preferences-form'), profile = byId('settings-profile-form'), password = byId('settings-password-form');
const categoryDialog = byId('settings-category-dialog'), categoryForm = categoryDialog.querySelector('form');
const resetDialog = byId('settings-reset-dialog'), resetForm = resetDialog.querySelector('form');
const profileFields = ['fullName','birthDate','hometown','monthlyIncome','usagePurpose','usagePurposeNote'];
const dirty = new Set();
let selectedCategory, requestId = 0;

function message(node,text='',failure=false) {
  node.textContent = text;
  node.hidden = !text;
  node.classList.toggle('finance-error',failure);
}

function button(label,click) {
  const control = element('button',label,'button');
  control.type = 'button';
  control.addEventListener('click',click);
  return control;
}

function renderCategories(categories) {
  for (const kind of ['income','expense']) {
    const list = categories.filter(item=>item.kind===kind);
    byId(`settings-${kind}-empty`).hidden = Boolean(list.length);
    byId(`settings-${kind}`).replaceChildren(...list.map(category=>{
      const row = element('li',undefined,'settings-category-row');
      const identity = element('div',undefined,'settings-category-identity');
      const title = element('strong',category.name);
      const metadata = (category.defaultKey ? 'Mặc định' : 'Cá nhân')+(category.hiddenAt ? ' · Đã ẩn' : '');
      const description = element('div',undefined,'finance-entry');
      description.append(title,element('small',metadata));
      identity.append(financeCategoryIcon(category.icon,category.kind,category.name,category.color),description);
      const actions = element('div',undefined,'finance-actions');
      actions.append(button('Sửa',()=>openCategory(category)),button(category.hiddenAt ? 'Hiện lại' : 'Ẩn',event=>toggleCategory(category,event.currentTarget)));
      row.append(identity,actions);
      return row;
    }));
  }
  byId('category-defaults').hidden = categories.filter(category=>category.defaultKey).length>=5;
}

function previews() {
  byId('settings-number-preview').textContent = formatVnd('1234567',preferences.elements.numberStyle.value);
  const cycle = financeCycle(undefined,Number(preferences.elements.cycleStartDay.value));
  byId('settings-cycle-preview').textContent = `${financeDate(cycle.from)} – ${financeDate(cycle.to)}`;
}

function showPreferences(value) {
  for (const [key,setting] of Object.entries(value)) preferences.elements[key].value = setting;
  previews();
}

function togglePurpose() {
  const other = profile.elements.usagePurpose.value==='other';
  byId('purpose-note-field').hidden = !other;
  profile.elements.usagePurposeNote.disabled = !other;
}

function showProfile(value) {
  for (const key of profileFields) setFieldValue(profile.elements[key],value[key] ?? '');
  togglePurpose();
}

async function load() {
  const request = ++requestId;
  retry.hidden = true;
  if (content.hidden) message(byId('settings-state'),'Đang tải cài đặt…');
  try {
    const data = await financeRequest(api);
    if (request!==requestId) return;
    setFinancePreferences(data.preferences);
    if (!dirty.has(preferences)) showPreferences(data.preferences);
    if (!dirty.has(profile)) showProfile(data.profile);
    renderCategories(data.categories);
    content.hidden = false;
    message(byId('settings-state'));
  } catch (error) {
    if (request!==requestId) return;
    message(byId('settings-state'),error.message,true);
    retry.hidden = false;
  }
}

function categoryPreview() {
  const {icon,kind,name,color,defaultColor} = categoryForm.elements;
  color.disabled = defaultColor.checked;
  byId('settings-category-preview').replaceChildren(financeCategoryIcon(icon.value,kind.value,name.value,color.disabled ? null : color.value),
    document.createTextNode(name.value.trim() || 'Tên danh mục'));
}

function openCategory(category) {
  selectedCategory = category;
  categoryForm.reset();
  const {name,kind,icon,color,defaultColor,hidden} = categoryForm.elements;
  icon.querySelector('[data-legacy]')?.remove();
  if (category?.icon && ![...icon.options].some(option=>option.value===category.icon)) {
    const option = new Option('Biểu tượng đang dùng',category.icon);
    option.dataset.legacy = 'true';
    icon.add(option);
  }
  name.value = category?.name ?? '';
  kind.value = category?.kind ?? 'expense';
  kind.disabled = Boolean(category);
  icon.value = category?.icon ?? '';
  color.value = category?.color ?? '#39664d';
  defaultColor.checked = !category?.color;
  hidden.checked = Boolean(category?.hiddenAt);
  byId('settings-category-title').textContent = category ? 'Sửa danh mục' : 'Thêm danh mục';
  categoryPreview();
  message(categoryForm.querySelector('.settings-message'));
  categoryDialog.showModal();
}

function categorySaved(text) {
  message(byId('category-status'),text);
  notifyFinanceChanged();
  load();
}

async function toggleCategory(category,control) {
  control.disabled = true;
  try {
    const {name,icon,color,hiddenAt} = category;
    await financeRequest(`${api}/categories/${category.id}`,'PUT',{name,icon,color,hidden:!hiddenAt});
    categorySaved(hiddenAt ? 'Đã hiện lại danh mục.' : 'Đã ẩn danh mục.');
  } catch (error) {
    message(byId('category-status'),error.message,true);
  } finally { control.disabled = false; }
}

function onSave(form,save) {
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    if (form.dataset.busy==='true') return;
    const data = Object.fromEntries(financeForm(form));
    const status = form.querySelector('.settings-message');
    const controls = [...form.querySelectorAll('button')];
    form.dataset.busy = 'true';
    controls.forEach(control=>{control.disabled=true;});
    message(status,'Đang lưu…');
    try { await save(data,status); }
    catch (error) { message(status,error.fields ? Object.values(error.fields).join(' ') : error.message,true); }
    finally {
      form.dataset.busy = 'false';
      controls.forEach(control=>{control.disabled=false;});
    }
  });
}

preferences.addEventListener('change',()=>{dirty.add(preferences);previews();});
profile.addEventListener('input',()=>dirty.add(profile));
profile.elements.usagePurpose.addEventListener('change',togglePurpose);
categoryForm.addEventListener('input',categoryPreview);
byId('category-add').addEventListener('click',()=>openCategory());
byId('category-defaults').addEventListener('click',async event=>{
  const control = event.currentTarget;
  control.disabled = true;
  try {
    await financeRequest(api+'/default-categories','POST',{});
    categorySaved('Đã thêm danh mục mặc định.');
  } catch (error) { message(byId('category-status'),error.message,true); }
  finally { control.disabled = false; }
});
byId('settings-reset').addEventListener('click',()=>{message(resetForm.querySelector('.settings-message'));resetDialog.showModal();});
retry.addEventListener('click',load);
for (const dialog of [categoryDialog,resetDialog]) {
  dialog.querySelector('[data-close]').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('cancel',event=>{if (dialog.querySelector('form').dataset.busy==='true') event.preventDefault();});
}

onSave(preferences,async (data,status)=>{
  const value = await financeRequest(api+'/preferences','PUT',{...data,cycleStartDay:Number(data.cycleStartDay)});
  setFinancePreferences(value);
  dirty.delete(preferences);
  showPreferences(value);
  notifyFinanceChanged(value);
  message(status,'Đã lưu tùy chọn.');
});
onSave(profile,async (data,status)=>{
  const {errors} = profileInput(data);
  for (const key of profileFields) {
    message(byId(key+'-error'),errors[key] || '',Boolean(errors[key]));
    if (errors[key]) profile.elements[key].setAttribute('aria-invalid','true');
    else profile.elements[key].removeAttribute('aria-invalid');
  }
  const firstError = Object.keys(errors)[0];
  if (firstError) {
    profile.elements[firstError].focus();
    message(status,'Kiểm tra lại các trường được đánh dấu.',true);
    return;
  }
  const saved = await financeRequest('/api/onboarding/profile','PUT',data);
  dirty.delete(profile);
  document.querySelectorAll('[data-user-name]').forEach(node=>{node.textContent=saved.full_name;});
  document.querySelectorAll('[data-user-initial]').forEach(node=>{node.textContent=[...saved.full_name][0].toLocaleUpperCase('vi-VN');});
  message(status,'Đã lưu hồ sơ.');
});
onSave(password,async data=>{
  await financeRequest(api+'/password','POST',data);
  password.reset();
  window.location.replace('/login?notice=password-reset');
});
onSave(categoryForm,async data=>{
  const id = selectedCategory?.id;
  await financeRequest(api+'/categories'+(id ? '/'+id : ''),id ? 'PUT' : 'POST',{
    name:data.name,kind:data.kind,icon:data.icon || null,color:data.color || null,hidden:categoryForm.elements.hidden.checked,
  });
  categoryDialog.close();
  categorySaved('Đã lưu danh mục.');
});
onSave(resetForm,async ()=>{
  const result = await financeRequest(api+'/restore-defaults','POST',{confirm:true});
  requestId++;
  dirty.delete(preferences);
  setFinancePreferences(result.preferences);
  showPreferences(result.preferences);
  renderCategories(result.categories);
  resetDialog.close();
  message(byId('settings-state'),'Đã khôi phục cài đặt mặc định.');
  notifyFinanceChanged(result.preferences);
});
onFinanceSession(load);
