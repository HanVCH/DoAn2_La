import { element, financeCategoryIcon, financeDate, financeNumberLocale, vnd } from './finance-api.js';

const byId = id=>document.getElementById(id);
const monthLabel = financeDate;
const asPercent = value=>(financeNumberLocale()==='vi-VN' ? String(value).replace('.',',') : String(value))+'%';
const palette = ['#39664d','#a35c35','#447781','#846a25','#765987','#63824a','#826459','#af5560'];

function svgNode(tag,attributes,text) {
  const node = document.createElementNS('http://www.w3.org/2000/svg',tag);
  for (const [key,value] of Object.entries(attributes)) node.setAttribute(key,value);
  if (text!==undefined) node.textContent = text;
  return node;
}

function choice(...children) {
  const control = element('button',undefined,'report-choice');
  control.type = 'button';
  control.append(...children);
  return control;
}

function renderBreakdown(total,categories) {
  const empty = BigInt(total)===0n;
  byId('report-empty-expense').hidden = !empty;
  byId('report-breakdown').hidden = empty;
  if (empty) return;

  const svg = byId('report-donut'), list = byId('report-category-list'), reading = byId('report-category-reading');
  svg.replaceChildren(svgNode('circle',{cx:95,cy:95,r:71,class:'report-donut-track'}));
  list.replaceChildren();
  let offset = 0n, spent = 0n;
  const controls = categories.map((item,index)=>{
    const color = item.color ?? palette[index%palette.length];
    spent += BigInt(item.spent);
    const endpoint = spent*10000n/BigInt(total);
    const arc = svgNode('circle',{cx:95,cy:95,r:71,pathLength:10000,stroke:color,
      'stroke-dasharray':`${endpoint-offset} 10000`,'stroke-dashoffset':-offset,
      transform:'rotate(-90 95 95)',class:'report-segment'});
    offset = endpoint;
    const marker = financeCategoryIcon(item.icon,'expense',item.name,color);
    const label = element('span',undefined,'report-category-name');
    label.append(marker,document.createTextNode(item.name));
    const button = choice(label,element('strong',vnd(item.spent)),element('span',asPercent(item.percent),'report-percent'));
    const row = element('li');
    row.append(button);
    list.append(row);
    svg.append(arc);
    return {arc,button};
  });
  const center = svgNode('text',{x:95,y:100,'text-anchor':'middle',class:'report-donut-number'});
  svg.append(center);

  function select(index) {
    const item = categories[index];
    controls.forEach(({arc,button},position)=>{
      const selected = index===position;
      arc.classList.toggle('selected',selected);
      button.setAttribute('aria-pressed',String(selected));
    });
    center.textContent = asPercent(item.percent);
    reading.textContent = `${item.name} · ${vnd(item.spent)} · ${asPercent(item.percent)} tổng chi`;
  }
  controls.forEach(({arc,button},index)=>{
    arc.addEventListener('click',()=>select(index));
    button.addEventListener('click',()=>select(index));
  });
  select(0);
}

function comparisonText(benchmark) {
  const difference = BigInt(benchmark.difference);
  const percent = benchmark.percent===null ? '—' : (benchmark.direction==='up' ? '+' : '')+asPercent(benchmark.percent);
  if (benchmark.direction==='same') return `Không đổi · ${vnd(0)} (${percent})`;
  const amount = difference===0n ? 'dưới 1 ₫' : vnd(difference<0n ? -difference : difference);
  return `${benchmark.direction==='up' ? 'Tăng' : 'Giảm'} ${amount} (${percent})`;
}

function renderTrend(series,comparison,mode,selectedIndex=series.length-1) {
  const compact = new Intl.NumberFormat(financeNumberLocale(),{notation:'compact',maximumFractionDigits:1});
  const benchmark = comparison[mode];
  byId('report-change').textContent = comparisonText(benchmark);
  byId('report-trend-reference').textContent = `${mode==='average' ? 'Trung bình 3 tháng trước' : 'Tháng trước'} · ${vnd(benchmark.reference)}`;
  const chart = byId('report-trend'), list = byId('report-month-list'), reading = byId('report-month-reading');
  chart.replaceChildren();
  list.replaceChildren();
  const peak = series.reduce((max,item)=>BigInt(item.spent)>max ? BigInt(item.spent) : max,4n);
  const unit = 10n**BigInt(peak.toString().length-1);
  const step = unit/4n || 1n;
  const ceiling = ((peak+step*4n-1n)/(step*4n))*step*4n;
  const top=14, bottom=172, left=76, right=426;
  const y = value=>bottom-(bottom-top)*Number(BigInt(value)*10000n/ceiling)/10000;
  for (let index=0n;index<=4n;index++) {
    const value = ceiling*index/4n, py = y(value);
    chart.append(svgNode('line',{x1:left,x2:right,y1:py,y2:py,class:'stock-grid'}),
      svgNode('text',{x:left-7,y:py+4,'text-anchor':'end',class:'stock-axis'},compact.format(value)+' ₫'));
  }
  const width = (right-left)/series.length;
  const controls = series.map((item,index)=>{
    const x = left+width*(index+0.5), py = y(item.spent), height = Math.max(2,bottom-py);
    const bar = svgNode('rect',{x:x-18,y:bottom-height,width:36,height,rx:3,class:'report-bar'});
    const hit = svgNode('rect',{x:x-width/2,y:top,width,height:bottom-top,class:'report-bar-hit'});
    const label = monthLabel(item.month);
    const button = choice(element('span',label),element('strong',vnd(item.spent)));
    const row = element('li');
    row.append(button);
    list.append(row);
    chart.append(bar,svgNode('text',{x,y:bottom+23,'text-anchor':'middle',class:'stock-axis'},label),hit);
    return {button,bar,hit};
  });
  if (mode==='average') {
    const lineY = y(benchmark.reference);
    chart.append(svgNode('line',{x1:left,x2:right,y1:lineY,y2:lineY,class:'report-benchmark'}));
  }
  function select(index) {
    chart.dataset.index = String(index);
    controls.forEach(({button,bar},position)=>{
      const selected = index===position;
      button.setAttribute('aria-pressed',String(selected));
      bar.classList.toggle('selected',selected);
    });
    const item = series[index];
    reading.textContent = `${monthLabel(item.month)} · ${vnd(item.spent)} · ${financeDate(item.from)} – ${financeDate(item.to)}`;
  }
  controls.forEach(({button,hit},index)=>{
    button.addEventListener('click',()=>select(index));
    hit.addEventListener('click',()=>select(index));
  });
  select(selectedIndex);
}

export function renderSpendingReport(total,report) {
  byId('report-total-expense').textContent = vnd(total);
  const asOf = byId('report-as-of');
  asOf.hidden = !report.asOf;
  asOf.textContent = report.asOf ? `Tính đến hôm nay · ${financeDate(report.asOf)}` : '';
  renderBreakdown(total,report.categories);
  const select = byId('report-comparison');
  select.onchange = ()=>renderTrend(report.series,report.comparisons,select.value,Number(byId('report-trend').dataset.index));
  renderTrend(report.series,report.comparisons,select.value);
}
