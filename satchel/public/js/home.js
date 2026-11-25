// Satchel shell: tab bar, app iframes and the dashboard. Vanilla ES module, DOM APIs only.

const Q = '(\\?[A-Za-z0-9=&_.%-]{0,120})?$';
const APPS = {
  almanac: { name: 'Almanac', desc: 'Calendar and planner', icon: '/almanac/img/icon.svg', path: '/almanac/app/', re: new RegExp('^/almanac/app/?' + Q) },
  margin: { name: 'Margin', desc: 'Notes and handwriting', icon: '/margin/img/icon.svg', path: '/margin/app', re: new RegExp('^/margin/app' + Q) },
  ledger: { name: 'Ledger', desc: 'Budgets and spending', icon: '/ledger/img/icon.svg', path: '/ledger/app', re: new RegExp('^/ledger/app' + Q) },
  stride: { name: 'Stride', desc: 'Workouts and meals', icon: '/stride/img/icon.svg', path: '/stride/app', re: new RegExp('^/stride/app' + Q) },
  tunnel: { name: 'Tunnel', desc: 'WireGuard VPN profiles', icon: '/tunnel/img/icon.svg', path: '/tunnel/app', re: new RegExp('^/tunnel/app' + Q) },
};
const APP_ORDER = ['almanac', 'margin', 'ledger', 'stride', 'tunnel'];
const MAX_TABS = 24;
const RECENT = 6;

const $ = id => document.getElementById(id);
const els = {
  topbar: $('topbar'), homeBtn: $('home-btn'), strip: $('tab-strip'), newTab: $('new-tab-btn'),
  userBtn: $('user-btn'), userPop: $('user-pop'), userName: $('user-name'), userAvatar: $('user-avatar'),
  signout: $('signout-btn'), content: $('content'), homeView: $('home-view'), frames: $('frames'),
  greeting: $('greeting'), dateLine: $('date-line'), sections: $('sections'), toast: $('toast'),
};

const state = { user: null, tabs: [], activeId: null, sections: {} };
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

function h(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}

// ---------- helpers ----------
function appForPath(path) {
  if (typeof path !== 'string') return null;
  return APP_ORDER.find(k => APPS[k].re.test(path)) || null;
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
function storageKey() { return 'satchel.tabs.v1:' + state.user.id; }
function saveState() {
  try { localStorage.setItem(storageKey(), JSON.stringify({ tabs: state.tabs, activeId: state.activeId })); } catch { /* storage unavailable */ }
}
function newId() {
  let id;
  do { id = 't' + Math.random().toString(36).slice(2, 9); } while (state.tabs.some(t => t.id === id));
  return id;
}
// First visit (nothing saved yet): start with Almanac open in a tab, behind Home.
function defaultTabs() {
  state.tabs.push({ id: newId(), app: 'almanac', path: APPS.almanac.path, title: APPS.almanac.name });
}

function loadState() {
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey()) || 'null');
    if (!raw || !Array.isArray(raw.tabs)) { defaultTabs(); return; }
    const seen = new Set();
    for (const t of raw.tabs) {
      if (!t || typeof t.id !== 'string' || !/^[A-Za-z0-9]{1,16}$/.test(t.id) || seen.has(t.id)) continue;
      const app = appForPath(t.path);
      if (!app) continue;
      seen.add(t.id);
      state.tabs.push({ id: t.id, app, path: t.path, title: typeof t.title === 'string' && t.title ? t.title.slice(0, 120) : APPS[app].name });
      if (state.tabs.length >= MAX_TABS) break;
    }
    if (typeof raw.activeId === 'string' && state.tabs.some(t => t.id === raw.activeId)) state.activeId = raw.activeId;
  } catch { /* corrupt or unavailable */ }
}

// ---------- tab strip ----------
const tabEls = new Map();

function tabById(id) { return state.tabs.find(t => t.id === id) || null; }

function renderTabs() {
  els.strip.textContent = '';
  tabEls.clear();
  for (const tab of state.tabs) {
    const active = tab.id === state.activeId;
    const el = h('div', 'tab app-' + tab.app);
    el.setAttribute('role', 'tab');
    el.setAttribute('aria-selected', active ? 'true' : 'false');
    el.tabIndex = active ? 0 : -1;
    el.dataset.id = tab.id;
    el.title = tab.title;
    el.append(h('span', 'tab-dot'), h('span', 'tab-title', tab.title));
    const close = h('button', 'tab-close');
    close.type = 'button';
    close.tabIndex = -1;
    close.setAttribute('aria-label', 'Close ' + tab.title);
    close.append(xIcon());
    close.addEventListener('click', e => { e.stopPropagation(); closeTab(tab.id); });
    el.append(close);
    wireTab(el, tab);
    els.strip.append(el);
    tabEls.set(tab.id, el);
  }
  els.homeBtn.classList.toggle('is-active', state.activeId === null);
  if (state.activeId === null) els.homeBtn.setAttribute('aria-current', 'page');
  else els.homeBtn.removeAttribute('aria-current');
}

function xIcon() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 12 12');
  svg.setAttribute('width', '10');
  svg.setAttribute('height', '10');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', 'M2.5 2.5l7 7M9.5 2.5l-7 7');
  p.setAttribute('fill', 'none');
  p.setAttribute('stroke', 'currentColor');
  p.setAttribute('stroke-width', '1.5');
  p.setAttribute('stroke-linecap', 'round');
  svg.append(p);
  return svg;
}

let suppressClick = false;

function wireTab(el, tab) {
  el.addEventListener('click', () => {
    if (suppressClick) return;
    activate(tab.id, { focus: 'content' });
  });
  el.addEventListener('mousedown', e => { if (e.button === 1) e.preventDefault(); });
  el.addEventListener('auxclick', e => { if (e.button === 1) { e.preventDefault(); closeTab(tab.id); } });
  el.addEventListener('keydown', e => {
    if (e.target !== el) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(tab.id, { focus: 'content' }); }
    else if (e.key === 'Delete') { e.preventDefault(); closeTab(tab.id); }
  });
  wireDrag(el, tab);
}

// Pointer-based drag to reorder.
function wireDrag(el, tab) {
  el.addEventListener('pointerdown', e => {
    if (e.button !== 0 || e.target.closest('.tab-close')) return;
    const startX = e.clientX;
    const grab = startX - el.getBoundingClientRect().left;
    const pid = e.pointerId;
    let dragging = false;

    const place = x => {
      el.style.transform = 'none';
      let natural = el.getBoundingClientRect().left;
      const center = () => { const r = el.getBoundingClientRect(); return r.left + r.width / 2 + (x - grab - natural); };
      for (let guard = 0; guard < 50; guard++) {
        const prev = el.previousElementSibling;
        const next = el.nextElementSibling;
        const c = center();
        if (prev) { const r = prev.getBoundingClientRect(); if (c < r.left + r.width / 2) { els.strip.insertBefore(el, prev); natural = el.getBoundingClientRect().left; continue; } }
        if (next) { const r = next.getBoundingClientRect(); if (c > r.left + r.width / 2) { els.strip.insertBefore(el, next.nextSibling); natural = el.getBoundingClientRect().left; continue; } }
        break;
      }
      el.style.transform = 'translateX(' + Math.round(x - grab - natural) + 'px)';
    };
    const move = ev => {
      if (ev.pointerId !== pid) return;
      if (!dragging) {
        if (Math.abs(ev.clientX - startX) < 6) return;
        dragging = true;
        try { el.setPointerCapture(pid); } catch { /* ignore */ }
        el.classList.add('is-dragging');
      }
      place(ev.clientX);
    };
    const end = ev => {
      if (ev.pointerId !== pid) return;
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', end);
      el.removeEventListener('pointercancel', end);
      if (!dragging) return;
      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 0);
      el.style.transform = '';
      el.classList.remove('is-dragging');
      const order = [...els.strip.children].map(c => c.dataset.id);
      state.tabs.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
      saveState();
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  });
}

// ---------- activation, frames ----------
function frameFor(tab) { return els.frames.querySelector('iframe[name="tk-tab-' + tab.id + '"]'); }

function ensureFrame(tab) {
  let f = frameFor(tab);
  if (f) return f;
  f = document.createElement('iframe');
  f.name = 'tk-tab-' + tab.id;
  f.className = 'tab-frame';
  f.title = tab.title;
  f.setAttribute('allow', 'clipboard-read; clipboard-write');
  f.addEventListener('load', () => { if (state.activeId === tab.id && pendingFocus === tab.id) { pendingFocus = null; focusFrame(f); } });
  f.src = tab.path;
  els.frames.append(f);
  return f;
}

let pendingFocus = null;
function focusFrame(f) { try { f.contentWindow.focus(); } catch { /* ignore */ } }

function activate(id, opts = {}) {
  const tab = id === null ? null : tabById(id);
  if (id !== null && !tab) return;
  const wasHome = state.activeId === null;
  state.activeId = tab ? tab.id : null;
  for (const f of els.frames.querySelectorAll('iframe')) f.classList.remove('is-active');
  if (tab) {
    const created = !frameFor(tab);
    const f = ensureFrame(tab);
    f.classList.add('is-active');
    if (opts.focus === 'content') { if (created) pendingFocus = tab.id; else focusFrame(f); }
  }
  els.content.classList.toggle('show-frames', !!tab);
  renderTabs();
  saveState();
  updateTitle();
  if (opts.focus === 'tab') {
    const target = tab ? tabEls.get(tab.id) : els.homeBtn;
    if (target) target.focus();
  } else if (!tab && opts.focus === 'content') {
    els.homeView.focus({ preventScroll: true });
  }
  scrollActiveIntoView();
  if (opts.initial) refreshAll(true);
  else if (!tab && !wasHome) refreshAll(false);
}

function scrollActiveIntoView() {
  const el = state.activeId ? tabEls.get(state.activeId) : null;
  if (el) el.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: reduceMotion.matches ? 'auto' : 'smooth' });
  else els.strip.scrollTo({ left: 0 });
}

function updateTitle() {
  const tab = state.activeId ? tabById(state.activeId) : null;
  document.title = tab ? tab.title + ' — Satchel' : 'Satchel';
}

function showHome() { activate(null, { focus: 'content' }); }

function openPath(path, title) {
  const app = appForPath(path);
  if (!app) return null;
  // One tab per app: opening another page of an open app (a note, a form) reuses its tab.
  const existing = state.tabs.find(t => t.app === app);
  if (existing) {
    const f = frameFor(existing);
    if (f && existing.path !== path) {
      try { f.contentWindow.postMessage({ source: 'satchel-shell', type: 'navigate', path }, location.origin); } catch { f.src = path; }
    } else if (!f) existing.path = path;
    activate(existing.id, { focus: 'content' });
    return existing;
  }
  if (state.tabs.length >= MAX_TABS) { toast('You have reached the limit of ' + MAX_TABS + ' open tabs. Close one to open another.'); return null; }
  const tab = { id: newId(), app, path, title: (title && String(title).slice(0, 120)) || APPS[app].name };
  state.tabs.push(tab);
  activate(tab.id, { focus: 'content' });
  return tab;
}

function closeTab(id) {
  const i = state.tabs.findIndex(t => t.id === id);
  if (i < 0) return;
  const wasActive = state.activeId === id;
  const [tab] = state.tabs.splice(i, 1);
  const f = frameFor(tab);
  if (f) f.remove();
  if (wasActive) {
    const next = state.tabs[i] || state.tabs[i - 1] || null;
    activate(next ? next.id : null, { focus: 'content' });
  } else {
    renderTabs();
    saveState();
  }
}

function switchBy(dir, focus) {
  const order = [null, ...state.tabs.map(t => t.id)];
  const i = order.indexOf(state.activeId);
  const j = Math.min(order.length - 1, Math.max(0, i + dir));
  if (j === i) return;
  activate(order[j], { focus });
}

// ---------- keyboard and swipe ----------
function isEditable(t) {
  return !!(t && t.closest && t.closest('input, textarea, select, [contenteditable], [data-tk-keep-arrows]'));
}

window.addEventListener('keydown', e => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  const dir = e.key === 'ArrowRight' ? 1 : -1;
  const focus = els.topbar.contains(e.target) ? 'tab' : 'content';
  if ((e.ctrlKey || e.metaKey) && e.altKey && !e.shiftKey) { e.preventDefault(); switchBy(dir, focus); return; }
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.defaultPrevented || isEditable(e.target)) return;
  if (e.target === els.userBtn || els.userPop.contains(e.target)) return;
  e.preventDefault();
  switchBy(dir, focus);
});

let wheelSum = 0, wheelLast = 0, wheelBlockedUntil = 0;
function inNoSwipe(t) {
  for (let n = t; n && n.nodeType === 1; n = n.parentElement) {
    const tag = n.tagName.toLowerCase();
    if (tag === 'canvas' || tag === 'svg' || n.hasAttribute('data-tk-no-swipe')) return true;
    if (n.scrollWidth > n.clientWidth) {
      const ox = getComputedStyle(n).overflowX;
      if (ox === 'auto' || ox === 'scroll') return true;
    }
  }
  return false;
}
window.addEventListener('wheel', e => {
  const now = performance.now();
  if (e.ctrlKey || e.defaultPrevented || !(Math.abs(e.deltaX) > Math.abs(e.deltaY) * 1.5)) return;
  if (now < wheelBlockedUntil || inNoSwipe(e.target)) return;
  if (now - wheelLast > 200) wheelSum = 0;
  wheelLast = now;
  wheelSum += e.deltaX;
  if (Math.abs(wheelSum) >= 120) {
    const dir = wheelSum > 0 ? 1 : -1;
    wheelSum = 0;
    wheelBlockedUntil = now + 600;
    switchBy(dir, 'none');
  }
}, { passive: true });

// ---------- messages from app tabs ----------
window.addEventListener('message', e => {
  if (e.origin !== location.origin) return;
  const msg = e.data;
  if (!msg || typeof msg !== 'object' || msg.source !== 'satchel-tab') return;
  const frame = [...els.frames.querySelectorAll('iframe')].find(f => f.contentWindow === e.source);
  if (!frame) return;
  const tab = tabById(frame.name.replace(/^tk-tab-/, ''));
  if (!tab) return;
  switch (msg.type) {
    case 'meta': {
      const app = appForPath(msg.path);
      if (!app) return;
      const title = typeof msg.title === 'string' && msg.title.trim() ? msg.title.trim().slice(0, 120) : APPS[app].name;
      if (tab.path === msg.path && tab.title === title && tab.app === app) return;
      tab.path = msg.path; tab.title = title; tab.app = app;
      frame.title = title;
      renderTabs(); saveState(); updateTitle(); scrollActiveIntoView();
      break;
    }
    case 'switch':
      if (msg.direction === 1 || msg.direction === -1) {
        if (state.activeId === tab.id) switchBy(msg.direction, 'content');
      }
      break;
    case 'home':
      showHome();
      break;
    case 'open':
      if (typeof msg.path === 'string') openPath(msg.path);
      break;
  }
});

// ---------- dashboard ----------
// One widget per app, filled from /api/dashboard (a small read-only summary).
function greetingFor(d) {
  const hr = d.getHours();
  return hr < 5 ? 'Up late' : hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
}
function money(cents, currency) {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'CAD' }).format((cents || 0) / 100); }
  catch { return ((cents || 0) / 100).toFixed(2); }
}
function widgetButton(label, path, primary) {
  const b = h('button', primary ? 'btn btn-primary btn-sm' : 'btn btn-sm', label);
  b.type = 'button';
  b.addEventListener('click', () => openPath(path));
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
      b.addEventListener('click', () => openPath('/margin/app?note=' + encodeURIComponent(n.id), n.title));
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
    tile.addEventListener('click', () => openPath(app.path));
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

els.homeBtn.addEventListener('click', showHome);
els.newTab.addEventListener('click', showHome);
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
  else if (e.key === 'Escape') { e.preventDefault(); setUserMenu(false); els.userBtn.focus(); }
  else if (e.key === 'Tab') setUserMenu(false);
});
els.signout.addEventListener('click', async () => {
  els.signout.disabled = true;
  try { await fetch('/api/auth/logout', { method: 'POST', headers: { 'X-Requested-With': 'satchel' }, credentials: 'same-origin' }); } catch { /* go home regardless */ }
  location.href = '/';
});

// ---------- start ----------
async function init() {
  // Loaded inside a frame (frame-escape.js is handling it): never run a second shell,
  // which would overwrite the real shell's saved tabs.
  if (window.top !== window) return;
  let me;
  try { me = await request('/api/auth/me'); } catch { return; }
  if (!me || !me.user || !me.user.id) { goAuth(); return; }
  state.user = me.user;
  const full = String(me.user.name || '').trim();
  const label = full || String(me.user.email || '').split('@')[0] || 'Account';
  els.userName.textContent = label;
  els.userAvatar.textContent = (label.charAt(0) || '?').toUpperCase();
  els.greeting.textContent = greetingFor(new Date()) + ', ' + (label.split(/\s+/)[0]);
  els.dateLine.textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  buildDashboard();
  loadState();

  // /?open=<path>
  let openParam = null;
  try {
    openParam = new URLSearchParams(location.search).get('open');
    if (openParam !== null) history.replaceState(null, '', '/');
  } catch { /* ignore */ }

  renderTabs();
  activate(state.activeId, { initial: true });
  if (openParam && appForPath(openParam)) openPath(openParam);
}
init();
