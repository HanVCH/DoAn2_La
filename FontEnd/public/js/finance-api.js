import { csrfHeaders } from './auth-api.js';
import { financeZone } from './transaction-policy.mjs';
import { categoryIconFor } from './category-icons.mjs';
import { displayDate } from './finance-fields.js';

export async function financeRequest(url, method = 'GET', body) {
  const response = await fetch(url,{
    method, credentials:'same-origin', cache:'no-store',
    headers:method === 'GET' ? { Accept:'application/json' } : csrfHeaders(),
    body:body === undefined ? undefined : JSON.stringify(body),
    signal:AbortSignal.timeout(15000),
  });
  const result = await response.json();
  if (!response.ok || !result.success) {
    const error = new Error(result.message || 'Chưa thể tải dữ liệu.');
    error.fields = result.data?.errors;
    error.code = result.code;
    error.data = result.data;
    throw error;
  }
  return result.data;
}

const money = new Intl.NumberFormat('vi-VN',{style:'currency',currency:'VND'});
const commaNumbers = new Intl.NumberFormat('en-US');
const defaultPreferences = {currency:'VND',numberStyle:'dots',cycleStartDay:1};
let preferences = defaultPreferences, owner;
export function setFinancePreferences(value,userId=owner) {
  preferences = {...defaultPreferences,...value};
  owner = userId;
}
export const financePreferences = ()=>preferences;
export const financeNumberLocale = ()=>preferences.numberStyle==='commas' ? 'en-US' : 'vi-VN';
export const formatVnd = (value,style) => style==='commas' ? commaNumbers.format(BigInt(value))+'\u00a0₫' : money.format(BigInt(value));
export const vnd = value => formatVnd(value,preferences.numberStyle);
const times = new Intl.DateTimeFormat('vi-VN',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit',timeZone:financeZone});
export const financeDate = displayDate;
export const financeTime = value => times.format(new Date(value));
export const kindLabel = kind => kind === 'income' ? 'Thu' : 'Chi';

export function financeCategoryIcon(key,kind,name,color) {
  const namespace = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(namespace,'svg');
  const use = document.createElementNS(namespace,'use');
  svg.setAttribute('class','app-icon');
  svg.setAttribute('aria-hidden','true');
  if (typeof color==='string' && /^#[0-9a-f]{6}$/i.test(color)) svg.style.color = color;
  use.setAttribute('href','/assets/category-icons.svg#'+categoryIconFor(key,kind,name));
  svg.append(use);
  return svg;
}

export function element(tag,text,className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

export function onFinanceSession(load) {
  document.addEventListener('la:session-ready',load);
  financeChannel?.addEventListener('message',event=>{
    if (document.body.dataset.sessionState !== 'ready') return;
    if (event.data?.preferences && event.data.owner===owner) setFinancePreferences(event.data.preferences);
    load();
  });
  if (document.body.dataset.sessionState === 'ready') load();
}

const financeChannel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('la-finance-' + location.origin) : null;
export function notifyFinanceChanged(value) {
  financeChannel?.postMessage(value ? {owner,preferences:value} : 'changed');
}
