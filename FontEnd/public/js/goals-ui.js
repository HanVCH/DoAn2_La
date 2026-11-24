import { element, financeDate, vnd } from './finance-api.js';

const goalStates = [
  [100,'good','Đã hoàn thành'],
  [75,'near','Gần đạt'],
  [50,'middle','Đạt nửa chặng đường'],
  [25,'moving','Đang tiến triển'],
  [0,'early','Mới bắt đầu'],
];

function goalProgress(goal) {
  const saved = BigInt(goal.savedAmount), target = BigInt(goal.targetAmount);
  const hundredths = saved*10000n / target;
  const whole = hundredths/100n;
  const fraction = String(hundredths%100n).padStart(2,'0').replace(/0+$/,'');
  const percent = whole.toLocaleString('vi-VN')+(fraction ? ','+fraction : '')+'%';
  const [,tone,label] = saved===0n ? [0,'zero','Chưa bắt đầu']
    : goalStates.find(([minimum])=>whole>=BigInt(minimum));
  return {percent,tone,label,barValue:hundredths>=10000n ? 100 : Number(hundredths)/100,
    missing:target>saved ? target-saved : 0n};
}

function goalDetails(goal,missing) {
  const values = element('dl',undefined,'goal-card-values');
  const rows = [['Mục tiêu',vnd(goal.targetAmount)],['Đã dành',vnd(goal.savedAmount)],['Còn thiếu',vnd(missing)]];
  if (goal.dueDate) rows.push(['Hạn hoàn thành',financeDate(goal.dueDate)]);
  for (const [label,value] of rows) {
    const row = element('div');
    row.append(element('dt',label),element('dd',value));
    values.append(row);
  }
  return values;
}

function goalActions(goal,actions) {
  const controls = element('div',undefined,'finance-actions goal-card-actions');
  for (const [action,label] of [['savings','Thêm tiền vào hũ'],['edit','Sửa hũ'],['remove','Xóa hũ']]) {
    const button = element('button',label,'button');
    button.type = 'button';
    button.addEventListener('click',()=>actions[action](goal));
    controls.append(button);
  }
  return controls;
}

export function renderGoals(container,goals,actions) {
  container.replaceChildren(...goals.map(goal=>{
    const {percent,tone,label,barValue,missing} = goalProgress(goal);
    const item = element('li',undefined,actions ? 'app-card goal-progress goal-card' : 'goal-progress');
    item.dataset.progress = tone;
    const title = element('div',undefined,'goal-progress-title');
    title.append(element(actions ? 'h2' : 'strong',goal.name),element('span',percent));
    const bar = element('progress',undefined,'goal-bar');
    bar.max = 100;
    bar.value = barValue;
    bar.setAttribute('aria-label',`Tiến độ ${goal.name}: ${percent}`);
    const meta = element('div',undefined,'goal-progress-meta');
    if (!actions) meta.append(element('span',`${vnd(goal.savedAmount)} / ${vnd(goal.targetAmount)}`));
    meta.append(element('strong',label,'goal-status'));
    item.append(title,bar,meta);
    if (actions) {
      item.append(goalDetails(goal,missing));
      if (goal.note) item.append(element('p',goal.note,'goal-card-note'));
      item.append(goalActions(goal,actions));
    }
    return item;
  }));
}
