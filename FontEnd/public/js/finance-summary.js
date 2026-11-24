import { financeCycle } from './transaction-policy.mjs';
import { element, financeCategoryIcon, financeDate, financePreferences, financeRequest, onFinanceSession, vnd } from './finance-api.js';
import { renderCashflow } from './cashflow-chart.js';
import { renderGoals } from './goals-ui.js';
import { renderSpendingReport } from './report-charts.js';

const mode = document.querySelector('[data-finance-summary]').dataset.financeSummary;
const status = document.querySelector('[data-finance-status]');
const month = document.querySelector('#report-month');
const year = document.querySelector('#report-year');
const reportData = document.querySelector('#report-data');
const retry = document.querySelector('#report-retry');
const items = document.querySelector('[data-finance-items]');
let requestVersion = 0;
let hasChosenPeriod = false;

function line(label,value,icon) {
  const item = element('li');
  const title = element('span',label,icon ? 'finance-icon-label' : undefined);
  if (icon) title.prepend(icon);
  item.append(title,element('strong',value));
  return item;
}
function budgetLines(budgets) {
  const {available,spent,remaining} = budgets.totals;
  return [
    line('Tổng hạn mức',vnd(available)),
    line('Đã chi trong ngân sách',vnd(spent)),
    line('Ngân sách còn lại',vnd(remaining)),
    ...budgets.overBudget.map(item=>line(item.category,'Vượt '+vnd(item.overage))),
  ];
}
function overview(data) {
  const hasLedger = data.wallets.length>0 || data.recent.length>0;
  const values = [data.balance,data.totals.income,data.totals.expense,BigInt(data.totals.income)+BigInt(data.totals.expense)];
  const notes = ['Tính trên tất cả ví và thẻ','Kỳ hiện tại','Kỳ hiện tại','Tổng thu cộng tổng chi trong kỳ'];
  document.querySelector('#overview-period').textContent = `${financeDate(data.cycle.from)} – ${financeDate(data.cycle.through)}`;
  document.querySelectorAll('#finance-stats .stat-card').forEach((card,index)=>{
    const value = card.querySelector('.stat-value');
    value.textContent = hasLedger ? vnd(values[index]) : '—';
    value.removeAttribute('aria-label');
    card.querySelector('.stat-note').textContent = hasLedger ? notes[index] : 'Chưa có dữ liệu để hiển thị';
  });
  const recent = document.querySelector('.recent-panel .empty-state, #finance-recent');
  if (recent && (data.recent.length || recent.id)) {
    const list = element('ul',undefined,'finance-list finance-summary');
    list.id = 'finance-recent';
    for (const tx of data.recent) {
      list.append(line(`${tx.note || tx.category} · ${financeDate(tx.date)}`,`${tx.kind==='income'?'+':'−'}${vnd(tx.amount)}`,financeCategoryIcon(tx.categoryIcon,tx.kind,tx.category,tx.categoryColor)));
    }
    if (!data.recent.length) list.append(line('Chưa có giao dịch',''));
    recent.replaceWith(list);
  }
  const budgetItems = document.querySelector('#dashboard-budget-items');
  const hasBudgets = data.budgets.items.length>0;
  budgetItems.replaceChildren(...(hasBudgets ? budgetLines(data.budgets) : []));
  budgetItems.hidden = !hasBudgets;
  document.querySelector('#dashboard-budget-empty').hidden = hasBudgets;
  renderCashflow(data.cycle,data.daily);
  const goals = document.querySelector('#dashboard-goals');
  renderGoals(goals,data.goals);
  goals.hidden = !data.goals.length;
  document.querySelector('#dashboard-goals-empty').hidden = Boolean(data.goals.length);
}

async function load() {
  if (month && !hasChosenPeriod) {
    const [yy,mm] = financeCycle(undefined,financePreferences().cycleStartDay).month.split('-');
    year.value = yy;
    month.value = mm;
  }
  if (year && !year.validity.valid) return;
  const version = ++requestVersion;
  status.hidden = false;
  status.textContent = 'Đang tải số liệu…';
  if (reportData) {
    reportData.hidden = true;
    retry.hidden = true;
  }
  try {
    const url = mode==='reports' ? `/api/reports?month=${year.value}-${month.value}` : '/api/finance/summary';
    const data = await financeRequest(url);
    if (version!==requestVersion) return;
    if (mode==='overview') overview(data);
    if (mode==='reports') {
      const { income,expense } = data.totals;
      items.replaceChildren(line('Tổng thu',vnd(income)),line('Tổng chi',vnd(expense)),line('Thu trừ chi',vnd(BigInt(income)-BigInt(expense))));
      renderSpendingReport(expense,data.report);
      document.querySelector('#report-range').textContent = `${financeDate(data.cycle.from)} – ${financeDate(data.cycle.to)}`;
      document.querySelector('#report-budget-period').textContent = financeDate(data.budgets.month);
      const recordedMonths = data.periods ?? [];
      document.querySelector('#report-recorded-months').hidden = !recordedMonths.length;
      document.querySelector('#finance-periods').replaceChildren(...recordedMonths.map(item=>
        line(financeDate(item.month),`Thu ${vnd(item.income)} · Chi ${vnd(item.expense)}`),
      ));
      document.querySelector('#report-budget').hidden = !data.budgets.items.length;
      document.querySelector('#report-budget-items').replaceChildren(...budgetLines(data.budgets));
      const balances = data.walletTotals;
      document.querySelector('#report-wallets').hidden = !data.wallets.length;
      document.querySelector('#report-wallet-items').replaceChildren(
        line('Tiền trong các ví',vnd(balances.assets)),line('Dư nợ',vnd(balances.debt)),
        line('Tiền còn lại sau khi trừ nợ thẻ',vnd(balances.net)),
      );
      reportData.hidden = false;
    }
    status.hidden = true;
  } catch (error) {
    if (version!==requestVersion) return;
    status.textContent = error.message || 'Chưa thể tải số liệu.';
    if (retry) retry.hidden = false;
  }
}
if (month) {
  month.addEventListener('change',()=>{hasChosenPeriod=true;load();});
  year.addEventListener('change',()=>{if (year.reportValidity()) {hasChosenPeriod=true;load();}});
  retry.addEventListener('click',load);
}
onFinanceSession(load);
