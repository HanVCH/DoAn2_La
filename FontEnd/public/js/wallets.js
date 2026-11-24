import { isVnd, localFinanceDate } from './transaction-policy.mjs';
import { financeForm, setFieldValue } from './finance-fields.js';
import { element, financeDate, financeRequest, notifyFinanceChanged, onFinanceSession, vnd } from './finance-api.js';

const api = '/api/wallets';
const byId = id=>document.getElementById(id);
const editor = byId('wallet-editor'), adjust = byId('wallet-adjust'), operation = byId('wallet-operation');
const archive = byId('wallet-archive'), history = byId('wallet-history');
const historyForm = byId('wallet-history-filter');
const types = {cash:'Tiền mặt',bank:'Tài khoản ngân hàng',ewallet:'Ví điện tử',credit:'Thẻ tín dụng'};
const moves = {income:'Thu',expense:'Chi',transfer:'Chuyển ví',adjustment:'Điều chỉnh số dư',payment:'Thanh toán thẻ'};
const signed = value=>BigInt(value)>0n ? '+'+vnd(value) : vnd(value);
const actualLabel = wallet=>wallet.kind==='credit' ? 'Dư nợ' : 'Số dư';
const validMoney = (value,credit)=>credit ? isVnd(value) : /^(?:0|-?[1-9]\d{0,17})$/.test(value);
let wallets = [], listVersion = 0, historyVersion = 0, historyPage = 1, query = new URLSearchParams();
let selected, historyWallet, expectedBalance, operationKind, lastOperation;

function message(node,text='') {
  node.textContent = text;
  node.hidden = !text;
}

function button(label,onClick) {
  const control = element('button',label,'button');
  control.type = 'button';
  control.addEventListener('click',onClick);
  return control;
}

function walletCard(wallet) {
  const card = element('li',undefined,'app-card wallet-card');
  const heading = element('div',undefined,'wallet-card-heading');
  heading.append(element('h2',wallet.name),element('small',types[wallet.kind]));
  const balance = element('div',undefined,'wallet-card-balance');
  balance.append(element('span',`${actualLabel(wallet)} hiện tại`),element('strong',vnd(wallet.balance)));
  const actions = element('div',undefined,'finance-actions wallet-card-actions');
  actions.append(button('Xem lịch sử',()=>openHistory(wallet)));
  if (!wallet.archivedAt) {
    actions.append(button(wallet.kind==='credit' ? 'Điều chỉnh dư nợ' : 'Điều chỉnh số dư',()=>openAdjust(wallet)),button('Sửa ví',()=>openEditor(wallet)));
  }
  actions.append(button(wallet.archivedAt ? 'Khôi phục' : 'Lưu trữ',()=>openArchive(wallet)));
  card.append(heading,balance);
  if (wallet.kind==='credit') {
    card.append(element('p',`Có thể chi thêm ${vnd(wallet.creditAvailable)} · Hạn mức thẻ ${vnd(wallet.creditLimit)}`));
    if (wallet.paymentDue) card.append(element('p',`Đến hạn ${financeDate(wallet.paymentDue)}`));
  }
  if (wallet.note) card.append(element('p',wallet.note,'wallet-note'));
  card.append(actions);
  return card;
}

async function load() {
  const request = ++listVersion;
  message(byId('wallet-state'),'Đang tải ví…');
  byId('wallet-retry').hidden = true;
  try {
    const data = await financeRequest(api);
    if (request!==listVersion) return;
    wallets = data.items;
    const active = wallets.filter(wallet=>!wallet.archivedAt);
    const archived = wallets.filter(wallet=>wallet.archivedAt);
    for (const [key,value] of Object.entries(data.totals)) byId('wallet-'+key).textContent = vnd(value);
    byId('wallet-totals').hidden = false;
    byId('wallet-tools').hidden = false;
    const cashWallets = active.filter(wallet=>wallet.kind!=='credit').length;
    byId('wallet-transfer').disabled = cashWallets<2;
    byId('wallet-payment').disabled = !cashWallets || cashWallets===active.length;
    byId('wallet-empty').hidden = Boolean(active.length);
    byId('wallet-items').replaceChildren(...active.map(walletCard));
    byId('wallet-archived').replaceChildren(...archived.map(walletCard));
    byId('wallet-archive-section').hidden = !archived.length;
    byId('wallet-archive-count').textContent = `(${archived.length})`;
    message(byId('wallet-state'));
  } catch (error) {
    if (request!==listVersion) return;
    message(byId('wallet-state'),error.message);
    byId('wallet-retry').hidden = false;
  }
}

function open(dialog) {
  message(dialog.querySelector('[role="alert"]'));
  dialog.showModal();
}

function editorType() {
  const credit = editor.querySelector('[name="kind"]').value==='credit';
  byId('wallet-opening-label').textContent = credit ? 'Dư nợ ban đầu (VND)' : 'Số dư ban đầu (VND)';
  for (const field of editor.querySelectorAll('[data-credit-only]')) {
    field.hidden = field.querySelector('input').disabled = !credit;
  }
}

function openEditor(wallet) {
  selected = wallet;
  const form = editor.querySelector('form');
  form.reset();
  if (wallet) for (const name of ['name','kind','openingAmount','creditLimit','paymentDue','note']) setFieldValue(form.elements[name],wallet[name] ?? '');
  byId('wallet-editor-title').textContent = wallet ? 'Sửa ví' : 'Thêm ví';
  editorType();
  open(editor);
}

function showCurrentBalance() {
  byId('wallet-adjust-current').textContent = `${selected.name} · ${actualLabel(selected)} hiện tại ${vnd(expectedBalance)}`;
}

function openAdjust(wallet) {
  selected = wallet;
  expectedBalance = wallet.balance;
  const form = adjust.querySelector('form');
  form.reset();
  byId('wallet-adjust-title').textContent = wallet.kind==='credit' ? 'Điều chỉnh dư nợ' : 'Điều chỉnh số dư';
  byId('wallet-actual-label').textContent = `${actualLabel(wallet)} thực tế (VND)`;
  showCurrentBalance();
  open(adjust);
}

function openArchive(wallet) {
  selected = wallet;
  byId('wallet-archive-title').textContent = wallet.archivedAt ? 'Khôi phục ví' : 'Lưu trữ ví';
  byId('wallet-archive-message').textContent = wallet.archivedAt ? `Khôi phục “${wallet.name}” để sử dụng trong giao dịch?`
    : `Lưu trữ “${wallet.name}”? Bạn vẫn có thể xem lịch sử của ví.`;
  open(archive);
  archive.querySelector('[data-close]').focus();
}

function fillWallets(select,credit,exclude) {
  const previous = select.value;
  const available = wallets.filter(wallet=>!wallet.archivedAt && (wallet.kind==='credit')===credit && wallet.id!==exclude);
  select.replaceChildren(new Option('Chọn ví',''),...available.map(wallet=>new Option(`${wallet.name} · ${vnd(wallet.balance)}`,wallet.id)));
  if (available.some(wallet=>wallet.id===previous)) select.value = previous;
}

function openOperation(kind) {
  operationKind = kind;
  const payment = kind==='payment';
  const form = operation.querySelector('form');
  form.reset();
  byId('wallet-operation-title').textContent = payment ? 'Thanh toán thẻ' : 'Chuyển tiền giữa ví';
  byId('wallet-source-label').textContent = payment ? 'Ví thanh toán' : 'Ví nguồn';
  byId('wallet-destination-label').textContent = payment ? 'Thẻ cần trả nợ' : 'Ví đích';
  fillWallets(form.elements.sourceId,false);
  fillWallets(form.elements.destinationId,payment);
  open(operation);
}

async function submit(dialog,work) {
  if (dialog.dataset.busy==='true') return;
  const alert = dialog.querySelector('[role="alert"]');
  const submitButton = dialog.querySelector('[type="submit"]');
  const label = submitButton.textContent;
  dialog.dataset.busy = 'true';
  for (const control of dialog.querySelectorAll('button')) control.disabled = true;
  submitButton.textContent = 'Đang lưu…';
  message(alert);
  try {
    await work();
    dialog.close();
    notifyFinanceChanged();
    load();
  } catch (error) {
    if (dialog===adjust && error.code==='WALLET_BALANCE_CHANGED') {
      expectedBalance = error.data.balance;
      showCurrentBalance();
    }
    message(alert,error.message);
  } finally {
    for (const control of dialog.querySelectorAll('button')) control.disabled = false;
    dialog.dataset.busy = 'false';
    submitButton.textContent = label;
  }
}

function bindSubmit(dialog,work) {
  dialog.querySelector('form').addEventListener('submit',event=>{
    event.preventDefault();
    const data = Object.fromEntries(financeForm(event.currentTarget));
    submit(dialog,()=>work(data));
  });
}

bindSubmit(editor,data=>{
  if (!validMoney(data.openingAmount,data.kind==='credit')) throw new Error('Nhập số dư hoặc dư nợ ban đầu bằng số nguyên VND hợp lệ.');
  if (data.kind==='credit' && (!isVnd(data.creditLimit) || data.creditLimit==='0')) throw new Error('Nhập hạn mức tín dụng lớn hơn 0.');
  return financeRequest(selected ? api+'/'+selected.id : api,selected ? 'PUT' : 'POST',data);
});
bindSubmit(adjust,data=>{
  if (!validMoney(data.actual,selected.kind==='credit')) throw new Error('Nhập số dư hoặc dư nợ thực tế bằng số nguyên VND hợp lệ.');
  return financeRequest(`${api}/${selected.id}/adjustments`,'POST',{...data,expectedBalance});
});
bindSubmit(archive,()=>financeRequest(`${api}/${selected.id}/archive`,'PUT',{archived:!selected.archivedAt}));
bindSubmit(operation,async data=>{
  if (!isVnd(data.amount) || data.amount==='0') throw new Error('Nhập số tiền bằng số nguyên VND lớn hơn 0.');
  const payload = JSON.stringify([operationKind,data]);
  if (lastOperation?.payload!==payload) lastOperation = {payload,requestId:crypto.randomUUID()};
  await financeRequest(`${api}/operations/${operationKind}`,'POST',{...data,requestId:lastOperation.requestId});
  lastOperation = null;
});

function renderChart(data) {
  byId('wallet-figure').hidden = false;
  byId('wallet-chart-caption').textContent = `${actualLabel(data.wallet)} cuối ngày · mọi biến động trong kỳ`;
  byId('wallet-chart-from').textContent = financeDate(data.from);
  byId('wallet-chart-to').textContent = financeDate(data.to);
  const points = [{date:data.from,balance:data.opening},...data.daily,{date:data.to,balance:data.closing}];
  const values = points.map(point=>BigInt(point.balance));
  const min = values.reduce((a,b)=>a<b ? a : b), max = values.reduce((a,b)=>a>b ? a : b);
  const y = index=>max===min ? 51 : 92-Number((values[index]-min)*800n/(max-min))/10;
  const start = Date.parse(data.from), span = Date.parse(data.to)-start;
  const coordinates = points.flatMap((point,index)=>{
    const x = span ? 8+(Date.parse(point.date)-start)*404/span : 8+404*index/(points.length-1);
    return index ? [`${x},${y(index-1)}`,`${x},${y(index)}`] : [`${x},${y(index)}`];
  });
  byId('wallet-chart').querySelector('polyline').setAttribute('points',coordinates.join(' '));
}

function historyRow(item,wallet) {
  const row = element('li');
  const title = element('span',undefined,'finance-entry');
  title.append(element('strong',moves[item.kind]),element('small',[financeDate(item.date),item.description,item.note].filter(Boolean).join(' · ')));
  const amount = element('span',undefined,'finance-entry wallet-history-amount');
  amount.append(element('strong',signed(item.delta)),element('small',`${actualLabel(wallet)} sau biến động ${vnd(item.balance)}`));
  row.append(title,amount);
  return row;
}

async function loadHistory() {
  const request = ++historyVersion;
  const parameters = new URLSearchParams(query);
  parameters.set('page',historyPage);
  const status = byId('wallet-history-state');
  byId('wallet-history-results').hidden = true;
  message(status,'Đang tải lịch sử…');
  try {
    const data = await financeRequest(`${api}/${historyWallet.id}/history?${parameters}`);
    if (request!==historyVersion || !history.open) return;
    byId('wallet-history-opening-label').textContent = `${actualLabel(data.wallet)} đầu kỳ`;
    byId('wallet-history-closing-label').textContent = `${actualLabel(data.wallet)} cuối kỳ`;
    byId('wallet-history-opening').textContent = vnd(data.opening);
    byId('wallet-history-closing').textContent = vnd(data.closing);
    renderChart(data);
    byId('wallet-history-items').replaceChildren(...data.items.map(item=>historyRow(item,data.wallet)));
    byId('wallet-history-pages').hidden = data.pages<2;
    byId('wallet-page').textContent = `${data.page}/${data.pages}`;
    byId('wallet-prev').disabled = data.page<=1;
    byId('wallet-next').disabled = data.page>=data.pages;
    historyPage = data.page;
    byId('wallet-history-results').hidden = false;
    message(status,data.items.length ? '' : 'Không có biến động phù hợp trong khoảng ngày này.');
  } catch (error) {
    if (request===historyVersion) message(status,error.message);
  }
}

function applyHistoryFilters() {
  historyPage = 1;
  query = new URLSearchParams(financeForm(historyForm));
  loadHistory();
}

function openHistory(wallet) {
  historyWallet = wallet;
  byId('wallet-history-title').textContent = `Lịch sử ví · ${wallet.name}`;
  const today = localFinanceDate();
  setFieldValue(historyForm.elements.from,today.slice(0,7)+'-01');
  setFieldValue(historyForm.elements.to,today);
  historyForm.elements.kind.value = '';
  history.showModal();
  applyHistoryFilters();
}

byId('wallet-add').addEventListener('click',()=>openEditor());
byId('wallet-retry').addEventListener('click',load);
byId('wallet-transfer').addEventListener('click',()=>openOperation('transfer'));
byId('wallet-payment').addEventListener('click',()=>openOperation('payment'));
editor.querySelector('[name="kind"]').addEventListener('change',editorType);
operation.querySelector('[name="sourceId"]').addEventListener('change',event=>{
  fillWallets(operation.querySelector('[name="destinationId"]'),operationKind==='payment',event.target.value);
});
historyForm.addEventListener('submit',event=>{event.preventDefault();applyHistoryFilters();});
byId('wallet-prev').addEventListener('click',()=>{historyPage--;loadHistory();});
byId('wallet-next').addEventListener('click',()=>{historyPage++;loadHistory();});
for (const dialog of [editor,adjust,operation,archive,history]) {
  dialog.querySelector('[data-close]').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('cancel',event=>{if(dialog.dataset.busy==='true') event.preventDefault();});
}
onFinanceSession(()=>{
  load();
  if (history.open) loadHistory();
});
