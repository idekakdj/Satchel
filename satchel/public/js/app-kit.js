// Satchel app kit: small helpers shared by Margin, Ledger, Stride and Tunnel.
// Plain ES module, DOM APIs only (the Content-Security-Policy forbids inline code).

export async function api(path, { method = 'GET', body } = {}) {
  const init = { method, credentials: 'same-origin', headers: { 'X-Requested-With': 'satchel' } };
  if (body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
  const res = await fetch(path, init);
  let data = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  if (res.status === 401) {
    const next = location.pathname + location.search;
    (window.top || window).location.href = '/auth?next=' + encodeURIComponent(next);
    throw Object.assign(new Error('Your session ended. Sign in again.'), { status: 401 });
  }
  if (!res.ok) throw Object.assign(new Error((data && data.error) || `Request failed (${res.status})`), { status: res.status, data });
  return data;
}

/** h('div.cls#id', {attrs}, children...) — attrs: on* handlers, class, text, dataset, style object. */
export function h(spec, attrs, ...children) {
  const m = /^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i.exec(spec) || [];
  const el = document.createElement(m[1] || 'div');
  for (const part of (m[2] || '').match(/[.#][\w-]+/g) || []) {
    if (part[0] === '.') el.classList.add(part.slice(1)); else el.id = part.slice(1);
  }
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { children.unshift(attrs); attrs = null; }
  let pendingValue;
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className += (el.className ? ' ' : '') + v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'value') pendingValue = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  if (pendingValue !== undefined) el.value = String(pendingValue);
  return el;
}

const ICONS = {
  plus: '<path d="M12 5v14M5 12h14"/>', x: '<path d="M6 6l12 12M18 6L6 18"/>', trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>', check: '<path d="M5 12l5 5L20 7"/>',
  chevronLeft: '<path d="M15 6l-6 6 6 6"/>', chevronRight: '<path d="M9 6l6 6-6 6"/>', chevronDown: '<path d="M6 9l6 6 6-6"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>', file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>', sidebar: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  pen: '<path d="M4 20l4-1L19 8l-3-3L5 16z"/>', pencil: '<path d="M4 20l1-4L16 5l3 3L8 19z"/><path d="M14 7l3 3"/>', highlighter: '<path d="M9 15l-4 5h6l2-2"/><path d="M9 15l8-8 3 3-8 8z"/>',
  eraser: '<path d="M7 20h13M5 15l9-9 5 5-7 7H9z"/>', type: '<path d="M4 7V4h16v3M9 20h6M12 4v16"/>', hand: '<path d="M8 13V5a1.5 1.5 0 0 1 3 0v6M11 11V4a1.5 1.5 0 0 1 3 0v7M14 11V5.5a1.5 1.5 0 0 1 3 0V14c0 4-2.5 7-6.5 7S5 18 4 15l-1.5-3.5a1.5 1.5 0 0 1 2.6-1.4L8 13"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>', redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>',
  pin: '<path d="M12 17v5M8 3h8l-1 6 3 4H6l3-4z"/>', more: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/>', upload: '<path d="M12 15V3M7 8l5-5 5 5"/><path d="M5 21h14"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>', key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3M15 8l2 2"/>',
  qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v1M14 20h1M18 18h3v3"/>',
  play: '<path d="M7 4l13 8-13 8z"/>', stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  grip: '<circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/>',
  up: '<path d="M6 15l6-6 6 6"/>', down: '<path d="M6 9l6 6 6-6"/>', star: '<path d="M12 3l2.8 5.8 6.2.9-4.5 4.4 1 6.2L12 17.4 6.5 20.3l1-6.2L3 9.7l6.2-.9z"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
  zoomIn: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M11 8v6M8 11h6"/>', zoomOut: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M8 11h6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 14H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 9 4.6V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
};
export function icon(name, size = 18) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', size); svg.setAttribute('height', size);
  svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round'); svg.setAttribute('aria-hidden', 'true');
  // Icon markup is a fixed constant above, never user data.
  svg.innerHTML = ICONS[name] || '';
  return svg;
}

let toastEl = null, toastTimer = 0;
export function toast(message, { error = false, action, actionLabel, ms } = {}) {
  if (!toastEl) { toastEl = h('div.kit-toast', { role: 'status', 'aria-live': 'polite' }); document.body.append(toastEl); }
  toastEl.textContent = '';
  toastEl.classList.toggle('error', !!error);
  toastEl.setAttribute('role', error ? 'alert' : 'status');
  toastEl.append(h('span', { text: message }));
  if (action) toastEl.append(h('button', { type: 'button', text: actionLabel || 'Undo', onclick: () => { toastEl.hidden = true; action(); } }));
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, ms || (error || action ? 7000 : 3500));
}

/** A modal sheet built from <dialog>. Returns { dialog, body, foot, close }. */
export function sheet(title, { wide = false, onClose } = {}) {
  const body = h('div.sheet-body');
  const foot = h('div.sheet-foot');
  // Let callers pass optional parts (cond ? el : null) like they can with h().
  for (const el of [body, foot]) el.append = (...nodes) => Element.prototype.append.apply(el, nodes.filter(n => n !== null && n !== undefined && n !== false));
  const closeBtn = h('button.icon-btn', { type: 'button', 'aria-label': 'Close', onclick: () => close() }, icon('x'));
  const dialog = h('dialog.sheet' + (wide ? '.wide' : ''), { 'aria-label': title }, h('div.sheet-head', h('h2', { text: title }), closeBtn), body, foot);
  let closed = false;
  function close() { if (closed) return; closed = true; try { dialog.close(); } catch { /* already closed */ } dialog.remove(); if (onClose) onClose(); }
  dialog.addEventListener('cancel', e => { e.preventDefault(); close(); });
  dialog.addEventListener('click', e => { if (e.target === dialog) close(); });
  // Enter in a single-line field submits the sheet's form (forms here keep their buttons in the footer).
  body.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
    const t = e.target;
    if (!t.matches || !t.matches('input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="file"])') || !t.form) return;
    e.preventDefault();
    t.form.requestSubmit();
  });
  document.body.append(dialog);
  dialog.showModal();
  return { dialog, body, foot, close };
}

export function confirmSheet(title, message, { confirmLabel = 'Delete', danger = true } = {}) {
  return new Promise(resolve => {
    let answered = false;
    const s = sheet(title, { onClose: () => { if (!answered) resolve(false); } });
    s.body.append(h('p', { text: message }));
    s.foot.append(
      h('button.btn', { type: 'button', text: 'Cancel', onclick: () => s.close() }),
      h('button.btn' + (danger ? '.btn-primary' : '.btn-accent'), { type: 'button', text: confirmLabel, onclick: () => { answered = true; s.close(); resolve(true); } }),
    );
  });
}

export function uid() {
  const b = new Uint8Array(12); crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function debounce(fn, ms) { let t = 0; const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; d.cancel = () => clearTimeout(t); return d; }
export function todayISO(d = new Date()) { const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return z.toISOString().slice(0, 10); }
export function addDaysISO(iso, n) { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return todayISO(d); }
export function fmtDate(iso, opts = { month: 'short', day: 'numeric' }) { const d = new Date(iso + 'T12:00:00'); return isNaN(d) ? iso : d.toLocaleDateString(undefined, opts); }
export function relTime(ts) {
  const s = Math.max(0, Math.round((Date.now() - Number(ts)) / 1000));
  if (s < 45) return 'just now';
  const units = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  for (const [u, secs] of units) if (s >= secs * 0.95 || u === 'minute') return rtf.format(-Math.max(1, Math.round(s / secs)), u);
  return '';
}
export function download(filename, text, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { href: url, download: filename, hidden: true });
  document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
}
export function pickFile(accept) {
  return new Promise(resolve => {
    const input = h('input', { type: 'file', accept, hidden: true });
    let done = false; const finish = f => { if (done) return; done = true; input.remove(); resolve(f); };
    input.addEventListener('change', () => finish(input.files && input.files[0] || null));
    input.addEventListener('cancel', () => finish(null));
    document.body.append(input); input.click();
  });
}

/**
 * One autosaved JSON document per app (see satchel/server/appdocs.js).
 * store.doc is the live document; call store.changed() after editing it.
 */
export function createDocStore(app, { defaults, migrate, onState, onConflict } = {}) {
  const store = {
    doc: null, revision: 0, state: 'idle', error: null,
    async load() {
      const r = await api('/api/apps/' + app);
      store.revision = r.revision || 0;
      store.doc = r.document ? (migrate ? migrate(r.document) : r.document) : defaults();
      return store.doc;
    },
    changed() { set('pending'); save(); },
    async flush() { save.cancel(); await write(); },
  };
  let inFlight = null, again = false;
  function set(s, err) { store.state = s; store.error = err || null; if (onState) onState(s, err); }
  async function write() {
    if (inFlight) { again = true; return inFlight; }
    if (store.state !== 'pending' && store.state !== 'error') return;
    set('saving');
    inFlight = (async () => {
      try {
        const r = await api('/api/apps/' + app, { method: 'PUT', body: { document: store.doc, baseRevision: store.revision } });
        store.revision = r.revision;
        set(again ? 'pending' : 'saved');
      } catch (err) {
        if (err.status === 409) { set('conflict', err); if (onConflict) onConflict(); }
        else { set('error', err); setTimeout(() => { if (store.state === 'error') void write(); }, 8000); }
      } finally { inFlight = null; }
      if (again) { again = false; await write(); }
    })();
    return inFlight;
  }
  const save = debounce(write, 700);
  // Save before the tab closes or the device sleeps.
  const flushNow = () => { if (store.state === 'pending') { save.cancel(); void write(); } };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushNow(); });
  window.addEventListener('pagehide', flushNow);
  return store;
}

export function saveLabel(el, state) {
  const text = { idle: '', pending: 'Unsaved changes…', saving: 'Saving…', saved: 'All changes saved', error: 'Not saved', conflict: 'Changed elsewhere' }[state] || '';
  el.textContent = text;
  el.classList.toggle('error', state === 'error' || state === 'conflict');
  el.title = state === 'error' ? 'Saving failed. Your next change will try again.' : state === 'conflict' ? 'Reload to see the newer version.' : '';
}

/** Run `fn(params)` now and whenever the shell asks this tab to open another page of the app. */
export function onShellNavigate(fn) {
  window.addEventListener('satchel:navigate', e => { e.preventDefault(); history.replaceState(null, '', e.detail.path); fn(new URLSearchParams(location.search)); });
}

export function escapeCsv(v) { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
export function parseCsv(text) {
  const rows = []; let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c; continue; }
    if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim() !== ''));
}
