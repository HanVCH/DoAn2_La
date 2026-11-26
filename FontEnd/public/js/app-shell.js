import { csrfHeaders } from './auth-api.js';
import { setFinancePreferences } from './finance-api.js';

const root = document.querySelector('#app-root'), screen = document.querySelector('#session-screen');
const loading = document.querySelector('#session-loading'), errorPanel = document.querySelector('#session-error');
const sidebar = document.querySelector('#app-sidebar'), workspace = document.querySelector('.app-workspace');
const menuButton = document.querySelector('#menu-toggle'), overlay = document.querySelector('#drawer-overlay');
const accountButton = document.querySelector('#account-toggle'), accountMenu = document.querySelector('#account-menu');
const logoutButton = document.querySelector('#logout-button');
const mobile = matchMedia('(max-width: 1050px)');
let checking = false, drawerOpen = false, previousFocus = null, loggingOut = false;

function internalPath(value) { return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !/[\\\s\u0000-\u001f]/.test(value); }
function showSessionError(message) {
  closeDrawer(false);closeAccount(false);root.hidden=true;root.inert=true;screen.hidden=false;
  loading.hidden=true;errorPanel.hidden=false;document.querySelector('#session-error-message').textContent=message;
  document.body.dataset.sessionState='error';
}
async function checkSession() {
  if (checking || loggingOut) return;
  checking=true;root.hidden=true;root.inert=true;screen.hidden=false;loading.hidden=false;errorPanel.hidden=true;
  document.body.dataset.sessionState='checking';
  try {
    const response=await fetch('/api/auth/me',{credentials:'include',cache:'no-store',headers:{Accept:'application/json'},signal:AbortSignal.timeout(15000)});
    const result=await response.json();
    if(response.status===401){window.location.replace('/login');return;}
    if(response.status===403 && result.code==='ONBOARDING_REQUIRED'){window.location.replace('/onboarding');return;}
    if(!response.ok || result.success!==true || typeof result.data?.needs_onboarding!=='boolean') throw new Error('SESSION_UNAVAILABLE');
    if(result.data.needs_onboarding){window.location.replace('/onboarding');return;}
    setFinancePreferences(result.data.preferences,result.data.user?.id);
    const name=result.data.user?.display_name;
    if(typeof name==='string' && name.trim()){
      document.querySelectorAll('[data-user-name]').forEach(node=>{node.textContent=name;});
      document.querySelectorAll('[data-user-initial]').forEach(node=>{node.textContent=[...name.trim()][0].toLocaleUpperCase('vi-VN');});
    }
    screen.hidden=true;root.hidden=false;root.inert=false;document.body.dataset.sessionState='ready';
    if(!mobile.matches)sidebar.inert=false;
    document.dispatchEvent(new Event('la:session-ready'));
  } catch { showSessionError('Không thể kiểm tra phiên đăng nhập. Vui lòng kiểm tra kết nối và thử lại.'); }
  finally { checking=false; }
}
document.querySelector('#retry-session').addEventListener('click',checkSession);

function closeAccount(restoreFocus=true) {
  const wasOpen=!accountMenu.hidden;accountMenu.hidden=true;accountButton.setAttribute('aria-expanded','false');
  if(wasOpen && restoreFocus)accountButton.focus();
}
accountButton.addEventListener('click',()=>{
  const open=accountMenu.hidden;accountMenu.hidden=!open;accountButton.setAttribute('aria-expanded',String(open));
  if(open)accountMenu.querySelector('a').focus();
});
document.addEventListener('click',event=>{if(!event.target.closest('.account-dropdown'))closeAccount(false);});
document.addEventListener('focusin',event=>{if(!event.target.closest('.account-dropdown') && !accountMenu.hidden)closeAccount(false);});

function closeDrawer(restoreFocus=true) {
  if(!drawerOpen){sidebar.inert=mobile.matches;return;}
  drawerOpen=false;document.body.classList.remove('drawer-open');overlay.hidden=true;menuButton.setAttribute('aria-expanded','false');
  sidebar.removeAttribute('role');sidebar.removeAttribute('aria-modal');workspace.inert=false;sidebar.inert=mobile.matches;
  if(restoreFocus && previousFocus?.isConnected)previousFocus.focus();
}
function openDrawer() {
  if(!mobile.matches)return;
  closeAccount(false);previousFocus=document.activeElement;drawerOpen=true;sidebar.inert=false;workspace.inert=true;
  document.body.classList.add('drawer-open');overlay.hidden=false;menuButton.setAttribute('aria-expanded','true');
  sidebar.setAttribute('role','dialog');sidebar.setAttribute('aria-modal','true');
  // Wait for the drawer's visibility style before moving keyboard focus into it.
  requestAnimationFrame(()=>{if(drawerOpen)sidebar.querySelector('[data-close-drawer]').focus({preventScroll:true});});
}
menuButton.addEventListener('click',openDrawer);
overlay.addEventListener('click',()=>closeDrawer());
sidebar.querySelector('[data-close-drawer]').addEventListener('click',()=>closeDrawer());
sidebar.querySelectorAll('a').forEach(link=>link.addEventListener('click',()=>closeDrawer(false)));
mobile.addEventListener('change',()=>{closeDrawer(false);sidebar.inert=mobile.matches;});
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'){
    if(drawerOpen){event.preventDefault();closeDrawer();}
    else if(!accountMenu.hidden){event.preventDefault();closeAccount();}
  }
  if(event.key==='Tab' && drawerOpen){
    const focusable=[...sidebar.querySelectorAll('a[href],button:not([disabled])')].filter(el=>el.getClientRects().length>0);
    const first=focusable[0],last=focusable.at(-1);
    if(event.shiftKey && document.activeElement===first){event.preventDefault();last.focus();}
    else if(!event.shiftKey && document.activeElement===last){event.preventDefault();first.focus();}
  }
});
sidebar.inert=mobile.matches;
logoutButton.addEventListener('click',async()=>{
  if(loggingOut)return;
  loggingOut=true;logoutButton.disabled=true;logoutButton.querySelector('span').textContent='Đang đăng xuất…';
  // Only clear the visible account after the server has revoked the session.
  try {
    const response=await fetch('/api/auth/logout',{method:'POST',credentials:'include',cache:'no-store',headers:csrfHeaders(),body:'{}',signal:AbortSignal.timeout(15000)});
    if(!response.ok && response.status!==401)throw new Error('LOGOUT_FAILED');
    document.dispatchEvent(new Event('la:logout'));
    root.hidden=true;root.inert=true;document.querySelectorAll('[data-user-name],[data-user-initial]').forEach(node=>{node.textContent='';});
    window.location.replace('/login');
  } catch {
    const message=document.querySelector('#app-error');message.hidden=false;message.textContent='Chưa thể đăng xuất. Vui lòng thử lại.';
    closeAccount(false);loggingOut=false;logoutButton.disabled=false;logoutButton.querySelector('span').textContent='Đăng xuất';
  }
});
document.querySelectorAll('[data-current-month]').forEach(node=>{node.textContent=new Intl.DateTimeFormat('vi-VN',{month:'long',year:'numeric',timeZone:'Asia/Ho_Chi_Minh'}).format(new Date());});
// BFCache and restored tabs must also check current server state before revealing data.
window.addEventListener('pagehide',()=>{closeDrawer(false);closeAccount(false);root.hidden=true;root.inert=true;});
window.addEventListener('pageshow',checkSession);
document.addEventListener('visibilitychange',()=>{if(document.hidden){root.hidden=true;root.inert=true;}else checkSession();});
