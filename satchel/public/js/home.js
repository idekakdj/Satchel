// Satchel shell: collapsible sidebar, app iframes and the dashboard. Vanilla ES module, DOM APIs only.

const Q = '(\\?[A-Za-z0-9=&_.%-]{0,120})?$';
const APPS = {
  almanac: { name: 'Almanac', desc: 'Calendar and planner', icon: '/almanac/img/icon.svg', path: '/almanac/app/', re: new RegExp('^/almanac/app/?' + Q) },
  margin: { name: 'Margin', desc: 'Notes and handwriting', icon: '/margin/img/icon.svg', path: '/margin/app', re: new RegExp('^/margin/app' + Q) },
  ledger: { name: 'Ledger', desc: 'Budgets and spending', icon: '/ledger/img/icon.svg', path: '/ledger/app', re: new RegExp('^/ledger/app' + Q) },
  stride: { name: 'Stride', desc: 'Workouts and meals', icon: '/stride/img/icon.svg', path: '/stride/app', re: new RegExp('^/stride/app' + Q) },
  tunnel: { name: 'Tunnel', desc: 'WireGuard VPN profiles', icon: '/tunnel/img/icon.svg', path: '/tunnel/app', re: new RegExp('^/tunnel/app' + Q) },
  // Satchel-wide settings (account, photo, time zone, sign out): opened from the account menu
  // or any app (Almanac's avatar), shown like an app but not listed in the sidebar.
  settings: { name: 'Settings', desc: 'Account and Satchel settings', icon: '/img/satchel.svg', path: '/account', re: new RegExp('^/account' + Q) },
};
const APP_ORDER = ['almanac', 'margin', 'ledger', 'stride', 'tunnel'];
const NAV_ORDER = ['home', ...APP_ORDER];
const FRAME_PREFIX = 'tk-tab-';
const SIDEBAR_KEY = 'satchel.sidebar.v1';

const $ = id => document.getElementById(id);
const els = {
  sidebar: $('sidebar'), nav: $('sb-nav'), toggle: $('sb-toggle'), backdrop: $('sb-backdrop'),
  menuBtn: $('menu-btn'), mobileTitle: $('mobilebar-title'), main: $('main'), sbClose: $('sb-close'), settingsBtn: $('settings-btn'),
  userBtn: $('user-btn'), userPop: $('user-pop'), userName: $('user-name'), userAvatar: $('user-avatar'),
  signout: $('signout-btn'), content: $('content'), homeView: $('home-view'), frames: $('frames'),
  greeting: $('greeting'), dateLine: $('date-line'), sections: $('sections'), toast: $('toast'),
};

// active: 'home' or an app key. paths/titles: last known page of each app.
const state = { user: null, active: 'home', paths: {}, titles: {}, sections: {} };
const narrow = window.matchMedia('(max-width: 759px)');

function h(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}

// ---------- helpers ----------
const VIEW_KEYS = [...APP_ORDER, 'settings'];
function appForPath(path) {
  if (typeof path !== 'string') return null;
  return VIEW_KEYS.find(k => APPS[k].re.test(path)) || null;
}

function goAuth() { location.href = '/auth?next=/'; }

async function request(path, opts = {}) {
  const init = { method: opts.method || 'GET', headers: { 'X-Requested-With': 'satchel' }, credentials: 'same-origin' };
  if (opts.body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(opts.body);
  }
  const res = await fetch(path, init);
  let data = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  if (res.status === 401) { goAuth(); throw new Error('Signed out'); }
  if (!res.ok) throw new Error((data && data.error) || 'Request failed (' + res.status + ')');
  return data;
}

let toastTimer = 0;
function toast(msg) {
  els.toast.textContent = msg;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { els.toast.hidden = true; }, 4000);
}

const rtf = typeof Intl !== 'undefined' && Intl.RelativeTimeFormat ? new Intl.RelativeTimeFormat(undefined, { numeric: 'always' }) : null;
function relTime(ts) {
  const t = Number(ts);
  if (!t) return '';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 45) return 'Edited just now';
  const units = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];
  for (const [u, secs] of units) {
    if (s >= secs * 0.95 || u === 'minute') {
      const n = Math.max(1, Math.round(s / secs));
      return 'Edited ' + (rtf ? rtf.format(-n, u) : n + ' ' + u + (n > 1 ? 's' : '') + ' ago');
    }
  }
  return '';
}

// ---------- persistence ----------
function storageKey() { return 'satchel.shell.v2:' + state.user.id; }
function saveState() {
  try { localStorage.setItem(storageKey(), JSON.stringify({ active: state.active, paths: state.paths })); } catch { /* storage unavailable */ }
}
function loadState() {
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey()) || 'null');
    if (!raw || typeof raw !== 'object') return;
    if (raw.paths && typeof raw.paths === 'object') {
      for (const k of VIEW_KEYS) if (typeof raw.paths[k] === 'string' && appForPath(raw.paths[k]) === k) state.paths[k] = raw.paths[k];
    }
    if (VIEW_KEYS.includes(raw.active)) state.active = raw.active;
  } catch { /* corrupt or unavailable */ }
}

// ---------- sidebar ----------
const NS = 'http://www.w3.org/2000/svg';
function homeIcon() {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('width', '20');
  svg.setAttribute('height', '20');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', 'M3.5 9.2 10 3.5l6.5 5.7V16a.8.8 0 0 1-.8.8H12v-4.4H8v4.4H4.3a.8.8 0 0 1-.8-.8z');
  p.setAttribute('fill', 'none');
  p.setAttribute('stroke', 'currentColor');
  p.setAttribute('stroke-width', '1.5');
  p.setAttribute('stroke-linejoin', 'round');
  svg.append(p);
  return svg;
}

const navEls = new Map();
function buildSidebar() {
  els.nav.textContent = '';
  NAV_ORDER.forEach((key, i) => {
    const isHome = key === 'home';
    const name = isHome ? 'Home' : APPS[key].name;
    const b = h('button', 'sb-item' + (isHome ? ' app-home' : ' app-' + key));
    b.type = 'button';
    b.dataset.key = key;
    b.dataset.tip = name;
    b.setAttribute('aria-label', name);
    b.title = name + '  (Ctrl+Alt+' + (i + 1) + ')';
    const ico = h('span', 'sb-icon');
    if (isHome) ico.append(homeIcon());
    else { const img = h('img'); img.src = APPS[key].icon; img.alt = ''; img.width = 24; img.height = 24; ico.append(img); }
    b.append(ico, h('span', 'sb-label', name));
    b.addEventListener('click', () => select(key, { focus: 'content' }));
    els.nav.append(b);
    navEls.set(key, b);
  });
}

function renderNav() {
  for (const [key, b] of navEls) {
    const on = key === state.active;
    b.classList.toggle('is-active', on);
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  }
}

function setCollapsed(on, persist) {
  document.body.classList.toggle('sb-collapsed', on);
  els.toggle.setAttribute('aria-expanded', on ? 'false' : 'true');
  els.toggle.setAttribute('aria-label', on ? 'Expand sidebar' : 'Collapse sidebar');
  els.toggle.title = on ? 'Expand sidebar' : 'Collapse sidebar';
  if (persist) { try { localStorage.setItem(SIDEBAR_KEY, on ? '1' : '0'); } catch { /* storage unavailable */ } }
}

function setDrawer(open, opts = {}) {
  const on = open && narrow.matches;
  const was = document.body.classList.contains('sb-open');
  document.body.classList.toggle('sb-open', on);
  els.backdrop.hidden = !on;
  els.menuBtn.setAttribute('aria-expanded', on ? 'true' : 'false');
  els.menuBtn.setAttribute('aria-label', on ? 'Close menu' : 'Open menu');
  // While the drawer covers the page, nothing behind it (including an app frame) can take focus.
  els.main.inert = on;
  els.sbClose.hidden = !on;
  if (was && !on && opts.restoreFocus) els.menuBtn.focus();
}

// ---------- switching, frames ----------
function frameFor(key) { return els.frames.querySelector('iframe[name="' + FRAME_PREFIX + key + '"]'); }

let pendingFocus = null;
function focusFrame(f) { try { f.contentWindow.focus(); } catch { /* ignore */ } }

function ensureFrame(key, path) {
  let f = frameFor(key);
  if (f) return f;
  f = document.createElement('iframe');
  f.name = FRAME_PREFIX + key;
  f.className = 'tab-frame';
  f.title = APPS[key].name;
  f.setAttribute('allow', 'clipboard-read; clipboard-write');
  f.addEventListener('load', () => {
    f.dataset.loaded = '1';
    if (state.active === key && pendingFocus === key) { pendingFocus = null; focusFrame(f); }
  });
  f.src = path;
  els.frames.append(f);
  return f;
}

// Show Home or an app. App frames are created on first open and then kept alive (hidden).
// opts.path: create the app's frame at this page. opts.focus: 'content' moves focus into the view.
function select(key, opts = {}) {
  if (key !== 'home' && !APPS[key]) return;
  if (key === 'settings') state.paths.settings = APPS.settings.path;
  const wasHome = state.active === 'home';
  state.active = key;
  for (const f of els.frames.querySelectorAll('iframe')) f.classList.remove('is-active');
  if (key !== 'home') {
    const created = !frameFor(key);
    const f = ensureFrame(key, opts.path || state.paths[key] || APPS[key].path);
    f.classList.add('is-active');
    if (created && opts.path) state.paths[key] = opts.path;
    if (opts.focus === 'content') { if (created) pendingFocus = key; else focusFrame(f); }
  } else if (opts.focus === 'content') {
    els.homeView.focus({ preventScroll: true });
  }
  els.content.classList.toggle('show-frames', key !== 'home');
  renderNav();
  saveState();
  updateTitle();
  if (narrow.matches) setDrawer(false);
  if (opts.initial) refreshAll(true);
  else if (key === 'home' && !wasHome) refreshAll(false);
}

function updateTitle() {
  const key = state.active;
  document.title = key === 'home' ? 'Satchel' : (state.titles[key] || APPS[key].name) + ' — Satchel';
  els.mobileTitle.textContent = key === 'home' ? 'Satchel' : (state.titles[key] || APPS[key].name);
}

function showHome() { select('home', { focus: 'content' }); }

// Open a path inside its app. If the app's frame exists it is told to navigate (every time,
// even to the same path); otherwise the frame is created at that path.
function openPath(path) {
  const key = appForPath(path);
  if (!key) return false;
  const f = frameFor(key);
  state.paths[key] = path;
  if (f) {
    if (f.dataset.loaded) {
      try { f.contentWindow.postMessage({ source: 'satchel-shell', type: 'navigate', path }, location.origin); } catch { f.src = path; }
    } else {
      f.src = path;
    }
    select(key, { focus: 'content' });
  } else {
    select(key, { focus: 'content', path });
  }
  return true;
}

// Dashboard buttons that just open an app keep its current page; specific paths navigate.
function openFromWidget(path) {
  const key = appForPath(path);
  if (key && path === APPS[key].path) select(key, { focus: 'content' });
  else openPath(path);
}

// ---------- keyboard ----------
window.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.body.classList.contains('sb-open')) {
    e.preventDefault();
    setDrawer(false, { restoreFocus: true });
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.altKey && !e.shiftKey) {
    const m = /^Digit([1-6])$/.exec(e.code || '');
    if (m) { e.preventDefault(); select(NAV_ORDER[Number(m[1]) - 1], { focus: 'content' }); }
  }
});

// ---------- messages from app frames ----------
window.addEventListener('message', e => {
  if (e.origin !== location.origin) return;
  const msg = e.data;
  if (!msg || typeof msg !== 'object' || msg.source !== 'satchel-tab') return;
  const frame = [...els.frames.querySelectorAll('iframe')].find(f => f.contentWindow === e.source);
  if (!frame) return;
  const key = frame.name.slice(FRAME_PREFIX.length);
  if (!APPS[key]) return;
  switch (msg.type) {
    case 'meta': {
      if (appForPath(msg.path) !== key) return;
      const title = typeof msg.title === 'string' && msg.title.trim() ? msg.title.trim().slice(0, 120) : APPS[key].name;
      state.paths[key] = msg.path;
      state.titles[key] = title;
      frame.title = title;
      saveState();
      if (state.active === key) updateTitle();
      break;
    }
    case 'home':
      showHome();
      break;
    case 'activate':
      // An app asks to come to the front as it is (a reminder was clicked): no navigation.
      select(key, { focus: 'content' });
      break;
    case 'settings':
      if (key === 'settings') void settingsChanged();
      break;
    case 'goto':
      if (Number.isInteger(msg.index) && msg.index >= 0 && msg.index < NAV_ORDER.length) select(NAV_ORDER[msg.index], { focus: 'content' });
      break;
    case 'open':
      if (typeof msg.path === 'string') openPath(msg.path);
      break;
  }
});

// ---------- dashboard ----------
// One widget per app, filled from /api/dashboard (a small read-only summary).
function money(cents, currency) {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'CAD' }).format((cents || 0) / 100); }
  catch { return ((cents || 0) / 100).toFixed(2); }
}
function widgetButton(label, path, primary) {
  const b = h('button', primary ? 'btn btn-primary btn-sm' : 'btn btn-sm', label);
  b.type = 'button';
  b.addEventListener('click', () => openFromWidget(path));
  return b;
}
function emptyLine(text) { return h('p', 'widget-empty', text); }
function bar(value, max, label) {
  const wrap = h('div', 'meter');
  wrap.setAttribute('role', 'meter');
  wrap.setAttribute('aria-valuemin', '0');
  wrap.setAttribute('aria-valuemax', String(Math.max(1, max)));
  wrap.setAttribute('aria-valuenow', String(Math.max(0, value)));
  if (label) wrap.setAttribute('aria-label', label);
  const fill = h('span', 'meter-fill' + (max > 0 && value > max ? ' over' : ''));
  fill.style.width = (max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0) + '%';
  wrap.append(fill);
  return wrap;
}
function stat(label, value) {
  const el = h('div', 'stat');
  el.append(h('span', 'stat-value', value), h('span', 'stat-label', label));
  return el;
}

const RENDER = {
  almanac(body, data) {
    const items = (data && data.upcoming) || [];
    if (!items.length) body.append(emptyLine('Nothing coming up in the next two weeks.'));
    const list = h('ul', 'widget-list');
    for (const it of items) {
      const li = h('li', 'widget-row');
      const dot = h('span', 'row-dot');
      if (it.color && /^#[0-9a-fA-F]{6}$/.test(it.color)) dot.style.background = it.color;
      const text = h('span', 'row-text');
      text.append(h('span', 'row-title', it.title), h('span', 'row-sub', it.when));
      li.append(dot, text);
      list.append(li);
    }
    if (items.length) body.append(list);
    return [widgetButton('Open calendar', APPS.almanac.path, true)];
  },
  margin(body, data) {
    const notes = (data && data.recent) || [];
    if (!notes.length) body.append(emptyLine('No notes yet. Start one for your next lecture.'));
    const list = h('ul', 'widget-list');
    for (const n of notes) {
      const li = h('li');
      const b = h('button', 'widget-row as-button');
      b.type = 'button';
      const text = h('span', 'row-text');
      text.append(h('span', 'row-title', n.title || 'Untitled note'), h('span', 'row-sub', (n.hasInk ? '✎ ' : '') + (n.preview ? n.preview.slice(0, 70) : relTime(n.updatedAt))));
      b.append(h('span', 'row-dot'), text);
      b.addEventListener('click', () => openPath('/margin/app?note=' + encodeURIComponent(n.id)));
      li.append(b);
      list.append(li);
    }
    if (notes.length) body.append(list);
    return [widgetButton('New note', '/margin/app?new=1', true), widgetButton('All notes', APPS.margin.path)];
  },
  ledger(body, data) {
    if (!data || data.empty) {
      body.append(emptyLine('Add an account and your first expense to see your month here.'));
      return [widgetButton('Set up Ledger', APPS.ledger.path, true)];
    }
    const stats = h('div', 'stats');
    stats.append(stat('Spent this month', money(data.spent, data.currency)), stat('Income', money(data.income, data.currency)), stat('Balance', money(data.balance, data.currency)));
    body.append(stats);
    if (data.budget > 0) {
      const left = data.budget - data.spent;
      body.append(bar(data.spent, data.budget, 'Monthly budget used'), h('p', 'widget-note', left >= 0 ? money(left, data.currency) + ' left of ' + money(data.budget, data.currency) + ' budgeted' : money(-left, data.currency) + ' over budget'));
    }
    return [widgetButton('Add expense', '/ledger/app?add=expense', true), widgetButton('Open Ledger', APPS.ledger.path)];
  },
  stride(body, data) {
    if (!data || data.empty) {
      body.append(emptyLine('Set your goals, then log meals and workouts.'));
      return [widgetButton('Set up Stride', APPS.stride.path, true)];
    }
    const stats = h('div', 'stats');
    stats.append(stat('Calories today', data.goal ? data.kcal.toLocaleString() + ' / ' + data.goal.toLocaleString() : data.kcal.toLocaleString()), stat('Workouts this week', String(data.workoutsThisWeek)));
    body.append(stats);
    if (data.goal) body.append(bar(data.kcal, data.goal, 'Calories eaten today'));
    if (data.next && data.next.id) {
      // The next planned meal or workout opens straight in Stride's plan.
      const n = data.next;
      const when = (n.date === todayInZone() ? 'Today' : n.date) + ' ' + n.time;
      const link = h('button', 'link-btn widget-note', 'Next: ' + n.name + ' · ' + when);
      link.type = 'button';
      link.addEventListener('click', () => openPath(n.kind === 'meal' ? '/stride/app?tab=plan&meal=' + encodeURIComponent(n.id) : '/stride/app?tab=workouts&planned=' + encodeURIComponent(n.id)));
      body.append(link);
    }
    if (data.lastWorkout) body.append(h('p', 'widget-note', 'Last workout: ' + data.lastWorkout.name + ' · ' + data.lastWorkout.date));
    return [widgetButton('Log food', '/stride/app?tab=meals', true), widgetButton('Start workout', '/stride/app?tab=workouts')];
  },
  tunnel(body, data) {
    const profiles = (data && data.profiles) || [];
    if (!profiles.length) body.append(emptyLine('No VPN profiles yet. Add one from your server or VPN provider.'));
    const list = h('ul', 'widget-list');
    for (const p of profiles.slice(0, 5)) {
      const li = h('li', 'widget-row');
      const text = h('span', 'row-text');
      text.append(h('span', 'row-title', p.name), h('span', 'row-sub', p.location || 'WireGuard'));
      li.append(h('span', 'row-dot'), text);
      list.append(li);
    }
    if (profiles.length) body.append(list);
    return [widgetButton(profiles.length ? 'Manage profiles' : 'Add a profile', APPS.tunnel.path, true)];
  },
};

function buildDashboard() {
  els.sections.textContent = '';
  const grid = h('div', 'dash-grid');
  for (const key of APP_ORDER) {
    const app = APPS[key];
    const sec = h('section', 'widget app-' + key);
    sec.setAttribute('aria-labelledby', 'w-' + key);
    const head = h('header', 'widget-head');
    const tile = h('button', 'app-tile');
    tile.type = 'button';
    tile.setAttribute('aria-label', 'Open ' + app.name);
    const img = h('img'); img.src = app.icon; img.alt = ''; img.width = 40; img.height = 40;
    tile.append(img);
    tile.addEventListener('click', () => select(key, { focus: 'content' }));
    const meta = h('div', 'app-meta');
    const name = h('h2', 'app-name', app.name);
    name.id = 'w-' + key;
    meta.append(name, h('p', 'app-desc', app.desc));
    head.append(tile, meta);
    const body = h('div', 'widget-body');
    const foot = h('footer', 'widget-foot');
    sec.append(head, body, foot);
    grid.append(sec);
    state.sections[key] = { key, body, foot };
  }
  els.sections.append(grid);
  renderDashboard(null, 'loading');
}

function renderDashboard(data, status) {
  for (const key of APP_ORDER) {
    const s = state.sections[key];
    s.body.textContent = '';
    s.foot.textContent = '';
    if (status === 'loading') {
      s.body.setAttribute('aria-busy', 'true');
      s.body.append(h('div', 'skel'), h('div', 'skel short'));
      continue;
    }
    s.body.removeAttribute('aria-busy');
    if (status === 'error') {
      const box = h('div', 'inline-error');
      box.setAttribute('role', 'alert');
      box.append(h('span', '', 'Could not load this summary.'));
      const retry = h('button', 'btn btn-sm', 'Retry');
      retry.type = 'button';
      retry.addEventListener('click', () => refreshAll(true));
      box.append(retry);
      s.body.append(box);
      s.foot.append(widgetButton('Open ' + APPS[key].name, APPS[key].path, true));
      continue;
    }
    const buttons = RENDER[key](s.body, data[key]);
    s.foot.append(...buttons);
  }
}

let dashToken = 0;
async function refreshAll(showSkeleton) {
  const token = ++dashToken;
  if (showSkeleton) renderDashboard(null, 'loading');
  try {
    const data = await request('/api/dashboard?tz=' + new Date().getTimezoneOffset());
    if (token === dashToken) renderDashboard(data || {}, 'ok');
  } catch (err) {
    if (token === dashToken && err.message !== 'Signed out') renderDashboard(null, 'error');
  }
}

// ---------- chrome wiring ----------
function setUserMenu(open) {
  els.userPop.hidden = !open;
  els.userBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
}

els.toggle.addEventListener('click', () => setCollapsed(!document.body.classList.contains('sb-collapsed'), true));
els.menuBtn.addEventListener('click', () => {
  const open = !document.body.classList.contains('sb-open');
  setDrawer(open, { restoreFocus: true });
  if (open) { const first = navEls.get(state.active) || els.nav.firstElementChild; if (first) first.focus(); }
});
els.backdrop.addEventListener('click', () => setDrawer(false, { restoreFocus: true }));
els.sbClose.addEventListener('click', () => setDrawer(false, { restoreFocus: true }));
narrow.addEventListener('change', () => setDrawer(false));

els.userBtn.addEventListener('click', e => {
  e.stopPropagation();
  const open = els.userPop.hidden;
  setUserMenu(open);
  if (open) { const first = els.userPop.querySelector('[role="menuitem"]'); if (first) first.focus(); }
});
document.addEventListener('click', e => { if (!els.userPop.hidden && !$('user-menu').contains(e.target)) setUserMenu(false); });
// A click inside an iframe never reaches this document, so close the menu on blur too.
window.addEventListener('blur', () => setUserMenu(false));
els.userPop.addEventListener('keydown', e => {
  const items = [...els.userPop.querySelectorAll('[role="menuitem"]')];
  const i = items.indexOf(document.activeElement);
  if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
  else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setUserMenu(false); els.userBtn.focus(); }
  else if (e.key === 'Tab') setUserMenu(false);
});
els.settingsBtn.addEventListener('click', () => { setUserMenu(false); select('settings', { focus: 'content' }); });
els.signout.addEventListener('click', async () => {
  els.signout.disabled = true;
  try { await fetch('/api/auth/logout', { method: 'POST', headers: { 'X-Requested-With': 'satchel' }, credentials: 'same-origin' }); } catch { /* go home regardless */ }
  location.href = '/';
});

// ---------- account: name, photo, time zone ----------
function browserZone() { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } }
function validZone(z) { if (typeof z !== 'string' || !z) return false; try { new Intl.DateTimeFormat('en-CA', { timeZone: z }); return true; } catch { return false; } }
function userZone() { return state.user && validZone(state.user.timeZone) ? state.user.timeZone : browserZone(); }
function todayInZone() {
  const p = {};
  for (const x of new Intl.DateTimeFormat('en-CA', { timeZone: userZone(), year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())) p[x.type] = x.value;
  return p.year + '-' + p.month + '-' + p.day;
}
function hourInZone() { return Number(new Intl.DateTimeFormat('en-CA', { timeZone: userZone(), hour: '2-digit', hourCycle: 'h23' }).format(new Date())) % 24; }
function showUser(u) {
  const full = String(u.name || '').trim();
  const label = full || String(u.email || '').split('@')[0] || 'Account';
  els.userName.textContent = label;
  els.userAvatar.textContent = '';
  if (typeof u.avatar === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(u.avatar)) {
    const img = h('img'); img.src = u.avatar; img.alt = ''; els.userAvatar.append(img);
    els.userAvatar.classList.add('has-photo');
  } else {
    els.userAvatar.textContent = (label.charAt(0) || '?').toUpperCase();
    els.userAvatar.classList.remove('has-photo');
  }
  els.userBtn.dataset.tip = label;
  els.userBtn.title = label;
  const hr = hourInZone();
  els.greeting.textContent = (hr < 5 ? 'Up late' : hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening') + ', ' + (label.split(/\s+/)[0]);
  els.dateLine.textContent = new Date().toLocaleDateString(undefined, { timeZone: userZone(), weekday: 'long', month: 'long', day: 'numeric' });
}
// Settings saved something: refresh the name and photo here, and tell every open app the zone.
async function settingsChanged() {
  let me;
  try { me = await request('/api/auth/me'); } catch { return; }
  if (!me || !me.user) return;
  state.user = me.user;
  showUser(me.user);
  for (const f of els.frames.querySelectorAll('iframe')) {
    if (!f.dataset.loaded) continue;
    try { f.contentWindow.postMessage({ source: 'satchel-shell', type: 'settings', timeZone: userZone() }, location.origin); } catch { /* ignore */ }
  }
  if (state.active === 'home') refreshAll(false);
}

// ---------- start ----------
async function init() {
  // Loaded inside a frame (frame-escape.js is handling it): never run a second shell,
  // which would overwrite the real shell's saved state.
  if (window.top !== window) return;
  let me;
  try { me = await request('/api/auth/me'); } catch { return; }
  if (!me || !me.user || !me.user.id) { goAuth(); return; }
  state.user = me.user;
  showUser(me.user);
  // First visit: the account takes this device's time zone until it is changed in Settings.
  if (!me.user.timeZone && validZone(browserZone())) {
    request('/api/account', { method: 'PATCH', body: { timeZone: browserZone() } }).then(r => { if (r && r.account) state.user.timeZone = r.account.timeZone; showUser(state.user); }).catch(() => {});
  }
  let collapsed = false;
  try { collapsed = localStorage.getItem(SIDEBAR_KEY) === '1'; } catch { /* ignore */ }
  setCollapsed(collapsed, false);
  buildSidebar();
  buildDashboard();
  loadState();

  // /?open=<path>
  let openParam = null;
  try {
    openParam = new URLSearchParams(location.search).get('open');
    if (openParam !== null) history.replaceState(null, '', '/');
  } catch { /* ignore */ }

  if (openParam && appForPath(openParam)) { openPath(openParam); refreshAll(true); }
  else if (openParam === 'settings') { select('settings', { focus: 'content' }); refreshAll(true); }
  else select(state.active, { initial: true });
}
init();
