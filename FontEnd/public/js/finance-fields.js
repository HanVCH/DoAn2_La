import { isFinanceDate, localFinanceDate } from './transaction-policy.mjs';

const pair = value=>String(value).padStart(2,'0');
const isMonth = input=>input.hasAttribute('data-month');
const isDate = input=>input.matches('[data-date],[data-month]');

export function displayDate(iso) {
  const [year,month,day] = iso.split('-');
  return day ? `${day}/${month}/${year.slice(-2)}` : `${month}/${year.slice(-2)}`;
}

function isoDate(input) {
  const raw = input.value.trim();
  if (!raw) return '';
  if (input.dataset.iso && raw===displayDate(input.dataset.iso)) return input.dataset.iso;
  const match = raw.match(isMonth(input) ? /^(\d{1,2})\/(\d{2}|\d{4})$/ : /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!match) return null;
  const year = match.at(-1);
  const fullYear = year.length===4 ? year : (Number(year)>=70 ? '19' : '20')+year;
  const prefix = `${fullYear}-${pair(match[isMonth(input) ? 1 : 2])}`;
  return isMonth(input) ? prefix : `${prefix}-${pair(match[1])}`;
}

function validationDate(input) {
  const iso = isoDate(input);
  const valid = iso==='' || (iso && isFinanceDate(isMonth(input) ? iso+'-01' : iso)
    && (!input.min || iso>=input.min) && (!input.max || iso<=input.max));
  input.setCustomValidity(valid ? '' : `Nhập ${isMonth(input) ? 'tháng theo mm/yy' : 'ngày theo dd/mm/yy'} hợp lệ.`);
  return valid ? iso : null;
}

export function fieldValue(input) {
  if (isDate(input)) return validationDate(input) ?? input.value;
  if (input.hasAttribute('data-money')) return input.value.replaceAll('.','').replace(',','.');
  return input.value;
}

function groupMoney(raw) {
  const match = raw.match(/^(-?)(\d*)(,\d*)?$/);
  return match ? match[1]+match[2].replace(/\B(?=(\d{3})+(?!\d))/g,'.')+(match[3] || '') : raw;
}

export function setFieldValue(input,value) {
  if (isDate(input)) {
    input.dataset.iso = value;
    input.value = value ? displayDate(value) : '';
    validationDate(input);
  } else if (input.hasAttribute('data-money')) {
    input.value = groupMoney(input.dataset.money==='decimal' ? value.replace('.',',') : value);
  } else input.value = value;
}

export function financeForm(form) {
  const data = new FormData(form);
  for (const input of form.querySelectorAll('[data-date],[data-month],[data-money]')) {
    if (data.has(input.name)) data.set(input.name,fieldValue(input));
  }
  return data;
}

function populateYears(select,min,max) {
  const today = Number(localFinanceDate().slice(0,4));
  const near = Math.min(max,today+25);
  const years = document.createDocumentFragment();
  for (let year=near;year>=min;year--) years.append(new Option(year,year));
  if (near<max) {
    const later = document.createElement('optgroup');
    later.label = 'Các năm sau';
    for (let year=Math.max(min,near+1);year<=max;year++) later.append(new Option(year,year));
    years.append(later);
  }
  select.append(years);
}

function pickerSelect(label,count) {
  const select = document.createElement('select');
  select.setAttribute('aria-label',label);
  if (count) for (let value=1;value<=count;value++) select.add(new Option(pair(value),pair(value)));
  return select;
}

function datePicker(input) {
  const wrapper = document.createElement('span');
  wrapper.className = 'finance-date-field';
  input.before(wrapper);
  wrapper.append(input);
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.textContent = 'Chọn';
  trigger.setAttribute('aria-label',isMonth(input) ? 'Chọn tháng và năm' : 'Chọn ngày, tháng và năm');
  trigger.setAttribute('aria-expanded','false');
  wrapper.append(trigger);
  const panel = document.createElement('span');
  panel.className = 'finance-date-picker';
  panel.hidden = true;
  wrapper.append(panel);
  const month = pickerSelect('Tháng',12), year = pickerSelect('Năm');
  const day = isMonth(input) ? null : pickerSelect('Ngày',31);
  if (day) panel.append(day);
  panel.append(month,year);
  const apply = document.createElement('button');
  apply.type = 'button';
  apply.textContent = 'Áp dụng';
  panel.append(apply);
  function updateDays() {
    if (!day) return;
    const max = new Date(Date.UTC(Number(year.value),Number(month.value),0)).getUTCDate();
    for (const option of day.options) option.disabled = Number(option.value)>max;
    if (Number(day.value)>max) day.value = pair(max);
  }
  trigger.addEventListener('click',()=>{
    if (input.disabled || input.readOnly) return;
    panel.hidden = !panel.hidden;
    trigger.setAttribute('aria-expanded',String(!panel.hidden));
    if (panel.hidden) return;
    if (!year.length) populateYears(year,Number(input.min.slice(0,4)) || 1000,Number(input.max.slice(0,4)) || 9999);
    const right = Math.min(window.innerWidth,wrapper.closest('dialog')?.getBoundingClientRect().right ?? window.innerWidth)-12;
    panel.style.left = `${Math.min(0,right-wrapper.getBoundingClientRect().left-panel.offsetWidth)}px`;
    const [yy,mm,dd] = (validationDate(input) || localFinanceDate()).split('-');
    year.value = yy;
    month.value = mm;
    if (day) day.value = dd;
    updateDays();
    (day ?? month).focus();
  });
  for (const control of [year,month]) control.addEventListener('change',updateDays);
  apply.addEventListener('click',()=>{
    setFieldValue(input,`${year.value}-${month.value}${day ? '-'+day.value : ''}`);
    panel.hidden = true;
    trigger.setAttribute('aria-expanded','false');
    input.dispatchEvent(new Event('input',{bubbles:true}));
    input.dispatchEvent(new Event('change',{bubbles:true}));
    input.focus();
  });
  wrapper.addEventListener('focusout',event=>{
    if (wrapper.contains(event.relatedTarget)) return;
    panel.hidden = true;
    trigger.setAttribute('aria-expanded','false');
  });
  input.addEventListener('input',()=>validationDate(input));
  input.addEventListener('change',()=>{
    const value = validationDate(input);
    if (value!==null) setFieldValue(input,value);
  });
}

for (const input of document.querySelectorAll('[data-date],[data-month]')) datePicker(input);
for (const select of document.querySelectorAll('select[data-year]')) {
  select.add(new Option('Chọn năm',''));
  populateYears(select,Number(select.dataset.min),9999);
}
for (const input of document.querySelectorAll('[data-money]')) {
  input.addEventListener('input',()=>{
    const before = input.value, caret = input.selectionStart;
    const formatted = groupMoney(before.replaceAll('.',''));
    if (formatted===before) return;
    const digitsBefore = before.slice(0,caret).replaceAll('.','').length;
    input.value = formatted;
    let position = 0, digits = 0;
    while (position<formatted.length && digits<digitsBefore) if (formatted[position++]!=='.') digits++;
    input.setSelectionRange(position,position);
  });
}
document.addEventListener('reset',event=>{
  for (const input of event.target.querySelectorAll('[data-date],[data-month]')) {
    delete input.dataset.iso;
    input.setCustomValidity('');
  }
});
