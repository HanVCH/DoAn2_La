import { csrfHeaders } from './auth-api.js';

const widget = document.querySelector('.support-chat');
const launcher = widget.querySelector('.support-launcher');
const panel = widget.querySelector('.support-panel');
const thread = widget.querySelector('.support-thread');
const messages = widget.querySelector('.support-messages');
const loading = widget.querySelector('[data-support-loading]');
const error = widget.querySelector('[data-support-error]');
const retry = widget.querySelector('[data-support-retry]');
const input = widget.querySelector('#support-question');
const form = widget.querySelector('.support-form');
const suggestions = [...widget.querySelectorAll('.support-suggestions button')];
const viewport = window.visualViewport;
const smallScreen = matchMedia('(max-width: 600px)');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const workspace = document.querySelector('.app-workspace');
const appRoot = document.querySelector('#app-root');
const motionToggle = widget.querySelector('[data-support-motion]');
const positionKey = 'la:support:position';
const motionKey = 'la:support:motion-disabled';
const chatKey = `la:support:chat:${widget.dataset.supportAccount}`;

function readStorage(name,key) {
  try { return JSON.parse(window[name].getItem(key)); } catch { return null; }
}
function writeStorage(name,key,value) {
  try {
    if (value === null) window[name].removeItem(key);
    else window[name].setItem(key,JSON.stringify(value));
  } catch { /* Support remains usable with storage disabled. */ }
}

let position = readStorage('localStorage',positionKey);
if (!Number.isFinite(position?.x) || !Number.isFinite(position?.y)) position = null;
let shownPosition;
let motionDisabled = readStorage('localStorage',motionKey) === true;
let hovering = false;
let idleTimer;
let patrolFrame;
const savedChat = readStorage('sessionStorage',chatKey);
const conversation = Array.isArray(savedChat?.messages) ? savedChat.messages.slice(-30) : [];
let pending = typeof savedChat?.pending === 'string' ? savedChat.pending : '';
let failure = pending ? savedChat.failure || 'Câu hỏi đang gửi bị gián đoạn. Bạn có thể thử lại.' : '';
let sending = false;
let signedOut = false;
let drag = null;
let suppressClick = false;
let requestController;

function saveChat() {
  if (signedOut) return;
  writeStorage('sessionStorage',chatKey,{open:!panel.hidden,messages:conversation,pending,failure});
}
function scrollToLatest() {
  if (!panel.hidden) thread.scrollTop = thread.scrollHeight;
}
function appendMessage(role,text) {
  const bubble = document.createElement('p');
  bubble.className = role === 'user' ? 'support-bubble is-user' : 'support-bubble';
  bubble.textContent = text;
  messages.append(bubble);
  while (messages.children.length > 30) messages.firstElementChild.remove();
}
function addMessage(role,text) {
  appendMessage(role,text);
  conversation.push({role,text});
  if (conversation.length > 30) conversation.shift();
}
for (const item of conversation) appendMessage(item.role,item.text);

function refreshStatus() {
  loading.hidden = !sending;
  error.hidden = !failure;
  error.textContent = failure;
  retry.hidden = !pending || !failure;
  form.querySelector('button').disabled = sending;
  suggestions.forEach(button=>{button.disabled = sending;});
  scrollToLatest();
}

const clamp = (value,min,max)=>Math.min(Math.max(value,min),Math.max(min,max));
function widgetBounds() {
  const padding = getComputedStyle(widget);
  const left = (viewport?.offsetLeft ?? 0) + parseFloat(padding.paddingLeft);
  const top = (viewport?.offsetTop ?? 0) + parseFloat(padding.paddingTop);
  const right = (viewport?.offsetLeft ?? 0) + (viewport?.width ?? innerWidth) - parseFloat(padding.paddingRight);
  const bottom = (viewport?.offsetTop ?? 0) + (viewport?.height ?? innerHeight) - parseFloat(padding.paddingBottom);
  return {left,top,right,bottom,size:launcher.offsetWidth};
}
function renderLauncher(x,y) {
  shownPosition = {x,y};
  launcher.style.translate = `${x}px ${y}px`;
}
function placeWidget(point = shownPosition ?? position) {
  if (!launcher.offsetWidth) return;
  const {left,top,right,bottom,size} = widgetBounds();
  const x = clamp(point?.x ?? right-size,left,right-size);
  const y = clamp(point?.y ?? bottom-size,top,bottom-size);
  launcher.style.inset = '0 auto auto 0';
  renderLauncher(x,y);
  if (panel.hidden) return;

  const gap = 10;
  const availableWidth = right-left;
  const width = smallScreen.matches ? availableWidth : Math.min(372,availableWidth);
  const above = y-top-gap;
  const below = bottom-y-size-gap;
  const height = Math.min(488,bottom-top,smallScreen.matches && above >= 320 ? above : Infinity);
  let panelX = clamp(x+size-width,left,right-width);
  let panelY = clamp(above >= below ? y-gap-height : y+size+gap,top,bottom-height);
  if (smallScreen.matches) {
    panelX = left;
    panelY = above >= 320 ? y-gap-height : bottom-height;
  } else if (Math.max(above,below) < height) {
    if (right-x-size >= width+gap) panelX = x+size+gap;
    else if (x-left >= width+gap) panelX = x-width-gap;
  }
  Object.assign(panel.style,{left:`${panelX}px`,top:`${panelY}px`,width:`${width}px`,height:`${height}px`});
}

function canPatrol() {
  return !motionDisabled && !reducedMotion.matches && panel.hidden && !drag && !hovering
    && !signedOut && !document.hidden && !appRoot.hidden && !launcher.matches(':focus-visible')
    && !document.body.classList.contains('drawer-open') && !document.querySelector('dialog[open]');
}
function startPatrol() {
  if (!canPatrol() || !shownPosition) return;
  const bounds = widgetBounds();
  const workspaceLeft = parseFloat(getComputedStyle(workspace).marginLeft);
  const left = Math.max(bounds.left,workspaceLeft ? workspaceLeft + 16 : 0);
  const top = bounds.top;
  const right = bounds.right-bounds.size;
  const bottom = bounds.bottom-bounds.size;
  if (right <= left || bottom <= top) return;

  const corners = [[left,bottom],[left,top],[right,top],[right,bottom]];
  const {x,y} = shownPosition;
  const edgeX = clamp(x,left,right);
  const edgeY = clamp(y,top,bottom);
  const edges = [[edgeX,bottom],[left,edgeY],[edgeX,top],[right,edgeY]];
  const distances = edges.map(([edgeX,edgeY])=>Math.hypot(edgeX-x,edgeY-y));
  let corner = distances.indexOf(Math.min(...distances));
  let [targetX,targetY] = edges[corner];
  let previous;
  launcher.classList.add('is-patrolling');

  function step(now) {
    const distance = Math.hypot(targetX-shownPosition.x,targetY-shownPosition.y);
    const stride = Math.min(now-(previous ?? now),50)*0.095;
    previous = now;
    if (distance <= stride) {
      renderLauncher(targetX,targetY);
      [targetX,targetY] = corners[corner];
      corner = (corner+1)%corners.length;
    } else {
      renderLauncher(shownPosition.x+(targetX-shownPosition.x)*stride/distance,
        shownPosition.y+(targetY-shownPosition.y)*stride/distance);
    }
    patrolFrame = requestAnimationFrame(step);
  }
  patrolFrame = requestAnimationFrame(step);
}
function schedulePatrol() {
  clearTimeout(idleTimer);
  cancelAnimationFrame(patrolFrame);
  launcher.classList.remove('is-patrolling');
  if (canPatrol()) idleTimer = setTimeout(startPatrol,8000);
}
function refreshMotionToggle() {
  motionToggle.hidden = reducedMotion.matches;
  motionToggle.textContent = motionDisabled ? 'Cho chạy' : 'Dừng chạy';
  schedulePatrol();
}

function setOpen(open,{focus=true}={}) {
  panel.hidden = !open;
  launcher.setAttribute('aria-expanded',String(open));
  launcher.setAttribute('aria-label',open ? 'Thu gọn Tổng đài hỗ trợ LÁ' : 'Mở Tổng đài hỗ trợ LÁ');
  placeWidget();
  scrollToLatest();
  saveChat();
  if (focus) (open ? input : launcher).focus({preventScroll:true});
  schedulePatrol();
}

launcher.addEventListener('pointerdown',event=>{
  if (!event.isPrimary || event.button !== 0) return;
  suppressClick = false;
  const rect = launcher.getBoundingClientRect();
  drag = {id:event.pointerId,startX:event.clientX,startY:event.clientY,x:rect.left,y:rect.top,moved:false};
  schedulePatrol();
  launcher.setPointerCapture(event.pointerId);
});
launcher.addEventListener('pointermove',event=>{
  if (drag?.id !== event.pointerId) return;
  const dx = event.clientX-drag.startX;
  const dy = event.clientY-drag.startY;
  if (!drag.moved && Math.hypot(dx,dy) < 7) return;
  drag.moved = true;
  placeWidget({x:drag.x+dx,y:drag.y+dy});
});
function endDrag(event) {
  if (drag?.id !== event.pointerId) return;
  const touchTap = event.type === 'pointerup' && event.pointerType === 'touch' && !drag.moved;
  suppressClick = drag.moved || event.type !== 'pointerup' || touchTap;
  if (drag.moved) {
    const rect = launcher.getBoundingClientRect();
    position = {x:rect.left,y:rect.top};
    writeStorage('localStorage',positionKey,position);
  }
  drag = null;
  if (touchTap) setOpen(panel.hidden);
  else schedulePatrol();
}
for (const event of ['pointerup','pointercancel','lostpointercapture']) launcher.addEventListener(event,endDrag);
launcher.addEventListener('click',event=>{
  if (suppressClick && (event.detail !== 0 || event.pointerType)) return;
  setOpen(panel.hidden);
});
launcher.addEventListener('pointerenter',event=>{
  if (event.pointerType !== 'touch') { hovering = true; schedulePatrol(); }
});
launcher.addEventListener('pointerleave',()=>{
  hovering = false;
  schedulePatrol();
});
launcher.addEventListener('focus',schedulePatrol);
launcher.addEventListener('blur',schedulePatrol);
widget.querySelector('[data-support-close]').addEventListener('click',()=>setOpen(false));
widget.querySelector('[data-support-reset]').addEventListener('click',()=>{
  position = null;
  writeStorage('localStorage',positionKey,null);
  placeWidget(null);
});
motionToggle.addEventListener('click',()=>{
  motionDisabled = !motionDisabled;
  writeStorage('localStorage',motionKey,motionDisabled);
  refreshMotionToggle();
});
document.addEventListener('keydown',event=>{
  if (event.key !== 'Escape' || event.defaultPrevented || panel.hidden || document.body.classList.contains('drawer-open') || document.querySelector('dialog[open]')) return;
  event.preventDefault();
  setOpen(false);
});
function refreshPlacement() {
  placeWidget(shownPosition ?? position);
  schedulePatrol();
}
window.addEventListener('resize',refreshPlacement);
viewport?.addEventListener('resize',refreshPlacement);
viewport?.addEventListener('scroll',refreshPlacement);
document.addEventListener('la:session-ready',refreshPlacement);
document.addEventListener('visibilitychange',schedulePatrol);
reducedMotion.addEventListener('change',refreshMotionToggle);
const modalObserver = new MutationObserver(schedulePatrol);
modalObserver.observe(document.body,{attributes:true,attributeFilter:['class']});
document.querySelectorAll('dialog').forEach(dialog=>{
  modalObserver.observe(dialog,{attributes:true,attributeFilter:['open']});
});
window.addEventListener('pagehide',schedulePatrol);

async function sendQuestion(question,{repeat=false}={}) {
  if (sending || !question) return;
  if (!repeat) addMessage('user',question);
  pending = question;
  failure = '';
  sending = true;
  requestController = new AbortController();
  refreshStatus();
  saveChat();
  try {
    const response = await fetch('/api/support/chat',{
      method:'POST',credentials:'same-origin',headers:csrfHeaders(),cache:'no-store',
      signal:AbortSignal.any([requestController.signal,AbortSignal.timeout(16_000)]),
      body:JSON.stringify({message:question}),
    });
    const result = await response.json();
    if (!response.ok || typeof result.data?.answer !== 'string') {
      throw new Error(result.message || 'Chưa thể gửi câu hỏi. Bạn có thể thử lại.');
    }
    addMessage('assistant',result.data.answer);
    pending = '';
  } catch (problem) {
    failure = problem.message && problem.name === 'Error' ? problem.message : 'Chưa thể kết nối với trợ lý. Bạn có thể thử lại.';
  } finally {
    sending = false;
    requestController = undefined;
    refreshStatus();
    saveChat();
  }
}

form.addEventListener('submit',event=>{
  event.preventDefault();
  const question = input.value.trim();
  if (!question || sending) return;
  input.value = '';
  sendQuestion(question);
});
for (const button of suggestions) button.addEventListener('click',()=>sendQuestion(button.textContent.trim()));
retry.addEventListener('click',()=>sendQuestion(pending,{repeat:true}));
document.addEventListener('la:logout',()=>{
  signedOut = true;
  schedulePatrol();
  requestController?.abort();
  writeStorage('sessionStorage',chatKey,null);
});

setOpen(savedChat?.open === true,{focus:false});
refreshMotionToggle();
refreshStatus();
