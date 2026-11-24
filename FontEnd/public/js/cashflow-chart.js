import { element, financeDate, financeNumberLocale, vnd } from './finance-api.js';

const width = 480, left = 62, right = 466, top = 14, bottom = 147;
function plotElement(tag,attributes,label) {
  const node = document.createElementNS('http://www.w3.org/2000/svg',tag);
  for (const [key,value] of Object.entries(attributes)) node.setAttribute(key,String(value));
  if (label !== undefined) node.textContent = label;
  return node;
}

export function renderCashflow(cycle,days) {
  const chart = document.querySelector('#cashflow-chart');
  const empty = document.querySelector('#cashflow-empty');
  chart.hidden = !days.length;
  empty.hidden = Boolean(days.length);
  if (!days.length) return;

  const svg = document.querySelector('#cashflow-svg');
  const reading = document.querySelector('#cashflow-reading');
  const slider = document.querySelector('#cashflow-day');
  const compact = new Intl.NumberFormat(financeNumberLocale(),{notation:'compact',maximumFractionDigits:1});
  const start = Date.parse(cycle.from), end = Date.parse(cycle.through), oneDay = 86400000;
  const crossesMonth = cycle.from.slice(0,7)!==cycle.through.slice(0,7);
  const byDate = new Map(days.map(day=>[day.date,day]));
  const series = Array.from({length:(end-start)/oneDay+1},(_,index)=>{
    const date = new Date(start+index*oneDay).toISOString().slice(0,10);
    return byDate.get(date) || {date,income:'0',expense:'0'};
  });
  const peak = series.reduce((max,day)=>{
    const value = BigInt(day.income)>BigInt(day.expense) ? BigInt(day.income) : BigInt(day.expense);
    return value>max ? value : max;
  },1n);
  const step = 10n ** BigInt(peak.toString().length-1);
  const ceiling = ((peak+step-1n)/step)*step;
  const x = index => series.length===1 ? (left+right)/2 : left+(right-left)*index/(series.length-1);
  const y = value => bottom-(bottom-top)*Number(BigInt(value)*10000n/ceiling)/10000;

  svg.replaceChildren();
  for (let index=0;index<=4;index++) {
    const level = ceiling*BigInt(index)/4n;
    const lineY = bottom-(bottom-top)*index/4;
    svg.append(
      plotElement('line',{x1:left,x2:right,y1:lineY,y2:lineY,class:'stock-grid'}),
      plotElement('text',{x:left-7,y:lineY+4,'text-anchor':'end',class:'stock-axis'},compact.format(level)+' đ'),
    );
  }
  const ticks = new Set([0,Math.floor((series.length-1)/3),Math.floor((series.length-1)*2/3),series.length-1]);
  for (const index of ticks) {
    svg.append(plotElement('line',{x1:x(index),x2:x(index),y1:top,y2:bottom,class:'stock-grid'}));
    const [,month,day] = series[index].date.split('-');
    svg.append(plotElement('text',{x:x(index),y:169,'text-anchor':'middle',class:'stock-axis'},crossesMonth ? `${day}/${month}` : String(Number(day))));
  }
  for (const kind of ['income','expense']) {
    const points = series.map((day,index)=>`${x(index)},${y(day[kind])}`);
    if (kind==='income') svg.append(plotElement('polygon',{
      points:`${x(0)},${bottom} ${points.join(' ')} ${x(series.length-1)},${bottom}`,class:'stock-area',
    }));
    svg.append(plotElement('polyline',{points:points.join(' '),class:`stock-line flow-${kind}`}));
  }

  const cursor = plotElement('line',{y1:top,y2:bottom,class:'stock-cursor'});
  const incomeDot = plotElement('circle',{r:4,class:'stock-dot flow-income'});
  const expenseDot = plotElement('circle',{r:4,class:'stock-dot flow-expense'});
  svg.append(cursor,incomeDot,expenseDot);
  const dateLabel = element('strong');
  const incomeLabel = element('span',undefined,'flow-income');
  const expenseLabel = element('span',undefined,'flow-expense');
  reading.replaceChildren(dateLabel,incomeLabel,expenseLabel);

  slider.max = String(series.length-1);
  slider.disabled = series.length===1;
  function select(index) {
    const day = series[index];
    const date = financeDate(day.date);
    dateLabel.textContent = date;
    incomeLabel.textContent = 'Thu '+vnd(day.income);
    expenseLabel.textContent = 'Chi '+vnd(day.expense);
    slider.value = String(index);
    slider.setAttribute('aria-valuetext',[date,incomeLabel.textContent,expenseLabel.textContent].join(', '));
    cursor.setAttribute('x1',x(index));
    cursor.setAttribute('x2',x(index));
    for (const [dot,kind] of [[incomeDot,'income'],[expenseDot,'expense']]) {
      dot.setAttribute('cx',x(index));
      dot.setAttribute('cy',y(day[kind]));
    }
  }
  function selectPointer(event) {
    const bounds = svg.getBoundingClientRect();
    const position = (event.clientX-bounds.left)*width/bounds.width;
    const fraction = Math.min(1,Math.max(0,(position-left)/(right-left)));
    select(Math.round(fraction*(series.length-1)));
  }
  svg.onpointermove = event=>{ if (event.pointerType==='mouse') selectPointer(event); };
  svg.onpointerdown = selectPointer;
  slider.oninput = ()=>select(Number(slider.value));
  select((Date.parse(days.at(-1).date)-start)/oneDay);
}
