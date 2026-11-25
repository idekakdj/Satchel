// Margin: folders sidebar, note editor with a text layer and an ink layer.
import { api, h, icon, toast, sheet, confirmSheet, uid, debounce, relTime, download, createDocStore, saveLabel, onShellNavigate } from '/js/app-kit.js';
import { InkLayer, renderPage } from './ink.js';

const $ = id => document.getElementById(id);
const PAGE_W = 820;
const FOLDER_COLORS = ['#e0a526', '#e9796b', '#5b8def', '#14a37f', '#9b6bdf', '#f05a3c', '#7cb518', '#8a7d70'];
const INK_COLORS = ['#1f1a15', '#2a5bd7', '#d1392b', '#1f8a4c', '#8a3fd1', '#e08a00'];
const HIGHLIGHT_COLORS = ['#ffd84d', '#7cf0a2', '#7cc8ff', '#ff9ec7', '#ffb35c'];

const els = {
  sidebar: $('sidebar'), toggle: $('sidebar-toggle'), scrim: $('scrim'), tree: $('tree'), search: $('search'),
  newNote: $('new-note'), newFolder: $('new-folder'), saveState: $('save-state'),
  noNote: $('no-note'), note: $('note'), title: $('title'), meta: $('note-meta'), toolbar: $('toolbar'),
  scroller: $('scroller'), page: $('page'), text: $('text'), ink: $('ink'), live: $('ink-live'),
};

const state = {
  notes: [],              // summaries
  current: null,          // full note being edited
  dirty: false,           // unsaved content
  saving: null,
  mode: 'type',           // 'type' | 'write'
  query: '',
  activeFolder: null,
  zoom: 1,
  fit: true,
};

// ---------- folders document ----------
const folders = createDocStore('margin', {
  defaults: () => ({ version: 1, folders: [], expanded: {}, sidebarOpen: true, fingerDraws: false, pen: { tool: 'pen', color: INK_COLORS[0], size: 2.4 } }),
  migrate: d => ({ version: 1, folders: [], expanded: {}, sidebarOpen: true, fingerDraws: false, pen: { tool: 'pen', color: INK_COLORS[0], size: 2.4 }, ...d }),
  onState: s => { if (!state.dirty && !state.saving) saveLabel(els.saveState, s === 'saved' ? 'saved' : s); },
  onConflict: () => toast('Your folders changed on another device.', { error: true, action: () => location.reload(), actionLabel: 'Reload' }),
});
const F = () => folders.doc;
const folderById = id => F().folders.find(f => f.id === id) || null;
function childrenOf(id) { return F().folders.filter(f => (f.parentId || null) === id).sort((a, b) => a.name.localeCompare(b.name)); }
function folderPath(id) { const out = []; let f = folderById(id), guard = 0; while (f && guard++ < 50) { out.unshift(f); f = folderById(f.parentId); } return out; }
function descendantIds(id) { const out = new Set([id]); let grew = true; while (grew) { grew = false; for (const f of F().folders) if (f.parentId && out.has(f.parentId) && !out.has(f.id)) { out.add(f.id); grew = true; } } return out; }
function notesIn(id) { return state.notes.filter(n => (folderById(n.folderId) ? n.folderId : null) === id).sort((a, b) => (b.pinned - a.pinned) || b.updatedAt - a.updatedAt); }
function countIn(id) { const ids = descendantIds(id); return state.notes.filter(n => ids.has(n.folderId)).length; }

// ---------- sidebar ----------
function setSidebar(open, persist = true) {
  els.sidebar.classList.toggle('collapsed', !open);
  els.toggle.setAttribute('aria-expanded', String(open));
  els.scrim.hidden = !open || !narrowMq.matches;
  if (persist && F().sidebarOpen !== open) { F().sidebarOpen = open; folders.changed(); }
  requestAnimationFrame(() => fitAndLayout());
}
// Wide screens follow the saved preference; narrow screens (iPad portrait, phones) start closed
// and show the sidebar over the page. Re-applied whenever the width crosses the breakpoint.
const narrowMq = window.matchMedia('(max-width: 860px)');
narrowMq.addEventListener('change', () => { if (folders.doc) setSidebar(!narrowMq.matches && F().sidebarOpen !== false, false); });
els.toggle.append(icon('sidebar'));
els.toggle.addEventListener('click', () => setSidebar(els.sidebar.classList.contains('collapsed')));
els.scrim.addEventListener('click', () => setSidebar(false));

function noteRow(n) {
  const row = h('div.t-row.note-row' + (state.current && state.current.id === n.id ? '.active' : ''), {
    role: 'treeitem', tabindex: 0, draggable: true, 'aria-selected': String(!!(state.current && state.current.id === n.id)),
    onclick: () => openNote(n.id),
    onkeydown: e => { if (e.key === 'Enter') openNote(n.id); },
    ondragstart: e => { e.dataTransfer.setData('text/x-margin-note', n.id); e.dataTransfer.effectAllowed = 'move'; },
  },
  h('span.twisty.none'),
  h('span.glyph', n.pinned ? icon('pin', 15) : icon('file', 15)),
  h('span.name', { text: n.title || 'Untitled note', title: n.preview || n.title }),
  h('button.icon-btn.menu-btn', { type: 'button', 'aria-label': 'Note options', onclick: e => { e.stopPropagation(); noteMenu(n, e.currentTarget); } }, icon('more', 16)));
  return row;
}
function dropTarget(row, folderId) {
  row.addEventListener('dragover', e => {
    const types = e.dataTransfer.types;
    if (types.includes('text/x-margin-note') || types.includes('text/x-margin-folder')) { e.preventDefault(); row.classList.add('drop'); }
  });
  row.addEventListener('dragleave', () => row.classList.remove('drop'));
  row.addEventListener('drop', e => {
    e.preventDefault(); row.classList.remove('drop');
    const noteId = e.dataTransfer.getData('text/x-margin-note');
    const fid = e.dataTransfer.getData('text/x-margin-folder');
    if (noteId) moveNote(noteId, folderId);
    else if (fid) moveFolder(fid, folderId);
  });
}
function folderRow(f, depth) {
  const open = !!F().expanded[f.id];
  const twisty = h('button.twisty' + (open ? '.open' : ''), { type: 'button', 'aria-label': open ? 'Collapse folder' : 'Expand folder', onclick: e => { e.stopPropagation(); toggleFolder(f.id); } }, icon('chevronRight', 14));
  const glyph = h('span.glyph.folder', icon('folder', 16));
  glyph.style.setProperty('--fc', f.color || FOLDER_COLORS[0]);
  const row = h('div.t-row.folder-row' + (state.activeFolder === f.id && !state.current ? '.active' : ''), {
    role: 'treeitem', tabindex: 0, draggable: true, 'aria-expanded': String(open), 'aria-level': depth + 1,
    onclick: () => { state.activeFolder = f.id; if (!open) toggleFolder(f.id); else renderTree(); },
    onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleFolder(f.id); } else if (e.key === 'ArrowRight' && !open) toggleFolder(f.id); else if (e.key === 'ArrowLeft' && open) toggleFolder(f.id); },
    ondragstart: e => { e.stopPropagation(); e.dataTransfer.setData('text/x-margin-folder', f.id); e.dataTransfer.effectAllowed = 'move'; },
  }, twisty, glyph, h('span.name', { text: f.name }), h('span.count', { text: String(countIn(f.id) || '') }),
  h('button.icon-btn.menu-btn', { type: 'button', 'aria-label': 'Folder options for ' + f.name, onclick: e => { e.stopPropagation(); folderMenu(f, e.currentTarget); } }, icon('more', 16)));
  dropTarget(row, f.id);
  const li = h('li', row);
  if (open) {
    const kids = h('ul', { role: 'group' });
    for (const c of childrenOf(f.id)) kids.append(folderRow(c, depth + 1));
    for (const n of notesIn(f.id)) kids.append(h('li', noteRow(n)));
    if (!kids.children.length) li.append(h('div.t-empty', { text: 'Empty folder' }));
    else li.append(kids);
  }
  return li;
}
function renderTree() {
  const tree = els.tree;
  tree.textContent = '';
  if (state.query) {
    tree.append(h('div.tree-section', { text: state.notes.length ? `Results (${state.notes.length})` : 'No matching notes' }));
    const ul = h('ul', { role: 'tree' });
    for (const n of state.notes) {
      const li = h('li', noteRow(n));
      const where = folderPath(n.folderId).map(f => f.name).join(' / ');
      if (n.preview || where) li.append(h('div.t-empty', { text: [where, n.preview].filter(Boolean).join(' · ').slice(0, 140) }));
      ul.append(li);
    }
    tree.append(ul);
    return;
  }
  const pinned = state.notes.filter(n => n.pinned);
  if (pinned.length) {
    tree.append(h('div.tree-section', { text: 'Pinned' }));
    tree.append(h('ul', { role: 'tree' }, pinned.map(n => h('li', noteRow(n)))));
  }
  const head = h('div.tree-section', { text: 'Folders' });
  tree.append(head);
  const ul = h('ul', { role: 'tree', 'aria-label': 'Folders' });
  for (const f of childrenOf(null)) ul.append(folderRow(f, 0));
  tree.append(ul);
  if (!F().folders.length) tree.append(h('div.t-empty', { text: 'No folders yet. Make one per course or project.' }));
  const loose = notesIn(null);
  const looseHead = h('div.tree-section', { text: 'Notes without a folder' });
  dropTarget(looseHead, null);
  tree.append(looseHead);
  if (loose.length) tree.append(h('ul', { role: 'tree' }, loose.map(n => h('li', noteRow(n)))));
  else tree.append(h('div.t-empty', { text: 'Drop a note here to take it out of its folder.' }));
}
function toggleFolder(id) { F().expanded[id] = !F().expanded[id]; if (!F().expanded[id]) delete F().expanded[id]; folders.changed(); renderTree(); }

// ---------- popover menus ----------
let openPop = null;
function closePop() { if (openPop) { openPop.remove(); openPop = null; } }
function popover(anchor, items) {
  closePop();
  const pop = h('div.pop', { role: 'menu' });
  for (const it of items) {
    if (it === '-') { pop.append(h('hr')); continue; }
    if (it.el) { pop.append(it.el); continue; }
    pop.append(h('button' + (it.danger ? '.danger' : ''), { type: 'button', role: 'menuitem', onclick: () => { closePop(); it.run(); } }, it.icon ? icon(it.icon, 16) : null, it.label));
  }
  document.body.append(pop);
  const r = anchor.getBoundingClientRect();
  const w = pop.offsetWidth, hgt = pop.offsetHeight;
  pop.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w)) + 'px';
  pop.style.top = (r.bottom + hgt + 8 > window.innerHeight ? Math.max(8, r.top - hgt - 4) : r.bottom + 4) + 'px';
  openPop = pop;
  const first = pop.querySelector('button'); if (first) first.focus();
  pop.addEventListener('keydown', e => { if (e.key === 'Escape') { closePop(); anchor.focus(); } });
}
document.addEventListener('pointerdown', e => { if (openPop && !openPop.contains(e.target)) closePop(); }, true);

function folderMenu(f, anchor) {
  const sw = h('div.swatches', FOLDER_COLORS.map(c => {
    const b = h('button', { type: 'button', 'aria-label': 'Folder colour ' + c, 'aria-pressed': String((f.color || FOLDER_COLORS[0]) === c), onclick: () => { f.color = c; folders.changed(); closePop(); renderTree(); } });
    b.style.background = c;
    return b;
  }));
  popover(anchor, [
    { label: 'New note here', icon: 'plus', run: () => newNote(f.id) },
    { label: 'New folder inside', icon: 'folder', run: () => newFolder(f.id) },
    { label: 'Rename', icon: 'edit', run: () => renameFolder(f) },
    '-', { el: sw }, '-',
    { label: 'Delete folder', icon: 'trash', danger: true, run: () => deleteFolder(f) },
  ]);
}
function noteMenu(n, anchor) {
  popover(anchor, [
    { label: n.pinned ? 'Unpin' : 'Pin to top', icon: 'pin', run: () => updateMeta(n.id, { pinned: !n.pinned }) },
    { label: 'Move to…', icon: 'folder', run: () => moveSheet(n) },
    { label: 'Download as image', icon: 'download', run: () => exportImage(n.id) },
    { label: 'Download text', icon: 'file', run: () => exportText(n.id) },
    '-',
    { label: 'Delete note', icon: 'trash', danger: true, run: () => deleteNote(n) },
  ]);
}

// ---------- folder actions ----------
function nameSheet(title, initial, label) {
  return new Promise(resolve => {
    let done = false;
    const s = sheet(title, { onClose: () => { if (!done) resolve(null); } });
    const input = h('input.input', { value: initial || '', maxlength: 80, 'aria-label': label, autocomplete: 'off' });
    const form = h('form', { onsubmit: e => { e.preventDefault(); const v = input.value.trim(); if (!v) return; done = true; s.close(); resolve(v.slice(0, 80)); } }, h('label.field', h('span', { text: label }), input));
    s.body.append(form);
    s.foot.append(h('button.btn', { type: 'button', text: 'Cancel', onclick: () => s.close() }), h('button.btn.btn-accent', { type: 'button', text: 'Save', onclick: () => form.requestSubmit() }));
    setTimeout(() => { input.focus(); input.select(); }, 30);
  });
}
async function newFolder(parentId = null) {
  const name = await nameSheet(parentId ? 'New folder inside ' + folderById(parentId).name : 'New folder', '', 'Folder name');
  if (!name) return;
  if (F().folders.length >= 500) return toast('You can have up to 500 folders.', { error: true });
  const f = { id: uid(), name, parentId: parentId || null, color: parentId ? (folderById(parentId).color || FOLDER_COLORS[0]) : FOLDER_COLORS[F().folders.length % FOLDER_COLORS.length] };
  F().folders.push(f);
  if (parentId) F().expanded[parentId] = true;
  F().expanded[f.id] = true;
  state.activeFolder = f.id;
  folders.changed();
  renderTree();
}
async function renameFolder(f) {
  const name = await nameSheet('Rename folder', f.name, 'Folder name');
  if (!name) return;
  f.name = name; folders.changed(); renderTree(); renderMeta();
}
async function deleteFolder(f) {
  const ids = descendantIds(f.id);
  const n = state.notes.filter(x => ids.has(x.folderId)).length;
  const ok = await confirmSheet('Delete “' + f.name + '”?', n ? `The folder is removed. Its ${n} note${n === 1 ? '' : 's'} and any folders inside move up to ${f.parentId ? '“' + folderById(f.parentId).name + '”' : 'the top level'}. No notes are deleted.` : 'The folder is removed. Any folders inside move up a level.', { confirmLabel: 'Delete folder' });
  if (!ok) return;
  const parent = f.parentId || null;
  for (const c of F().folders) if (c.parentId === f.id) c.parentId = parent;
  F().folders = F().folders.filter(x => x.id !== f.id);
  delete F().expanded[f.id];
  folders.changed();
  for (const note of state.notes.filter(x => x.folderId === f.id)) await moveNote(note.id, parent, true);
  renderTree(); renderMeta();
}
function moveFolder(id, parentId) {
  const f = folderById(id);
  if (!f || id === parentId) return;
  if (parentId && descendantIds(id).has(parentId)) return toast('A folder cannot go inside itself.', { error: true });
  f.parentId = parentId || null;
  if (parentId) F().expanded[parentId] = true;
  folders.changed(); renderTree(); renderMeta();
}

// ---------- notes ----------
async function loadNotes() {
  const r = await api('/api/notes' + (state.query ? '?q=' + encodeURIComponent(state.query) : ''));
  state.notes = r.notes || [];
  renderTree();
}
const searchNow = debounce(() => { loadNotes().catch(err => toast(err.message, { error: true })); }, 250);
els.search.addEventListener('input', () => { state.query = els.search.value.trim(); searchNow(); });

async function newNote(folderId) {
  await flushNote();
  const target = folderId !== undefined ? folderId : (state.current ? state.current.folderId : state.activeFolder);
  try {
    const r = await api('/api/notes', { method: 'POST', body: { title: 'Untitled note', folderId: folderById(target) ? target : null, paper: state.current ? state.current.paper : 'lined' } });
    state.notes.unshift(r.note);
    if (r.note.folderId) { for (const f of folderPath(r.note.folderId)) F().expanded[f.id] = true; folders.changed(); }
    await openNote(r.note.id, r.note);
    els.title.focus(); els.title.select();
  } catch (err) { toast(err.message, { error: true }); }
}
async function openNote(id, preloaded) {
  if (state.current && state.current.id === id) { if (narrowMq.matches) setSidebar(false, false); return; }
  await flushNote();
  try {
    const note = preloaded || (await api('/api/notes/' + encodeURIComponent(id))).note;
    state.current = note;
    state.dirty = false;
    history.replaceState(null, '', '/margin/app?note=' + encodeURIComponent(note.id));
    document.title = (note.title || 'Note') + ' — Margin';
    showNote();
    if (narrowMq.matches) setSidebar(false, false);
  } catch (err) {
    toast(err.status === 404 ? 'That note no longer exists.' : err.message, { error: true });
    if (err.status === 404) { state.notes = state.notes.filter(n => n.id !== id); renderTree(); }
  }
}
function showNote() {
  const n = state.current;
  els.noNote.hidden = !!n;
  els.note.hidden = !n;
  if (!n) { renderTree(); return; }
  els.title.value = n.title;
  els.text.value = n.text || '';
  els.page.className = 'page ' + (n.paper || 'lined');
  ink.load(n.ink && n.ink.strokes);
  renderToolbar();
  renderMeta();
  renderTree();
  requestAnimationFrame(() => { sizePage(); fitAndLayout(); els.scroller.scrollTop = 0; });
}
function renderMeta() {
  const n = state.current;
  if (!n) return;
  const path = folderPath(n.folderId).map(f => f.name).join(' / ') || 'No folder';
  els.meta.textContent = '';
  els.meta.append(...[
    h('button.pill', { type: 'button', title: 'Move to another folder', onclick: () => moveSheet(n) }, icon('folder', 13), path),
    h('span', { text: 'Edited ' + relTime(n.updatedAt) }),
    n.pinned ? h('span.pill', icon('pin', 12), 'Pinned') : null,
  ].filter(Boolean));
}

function summaryOf(n) { return { id: n.id, folderId: n.folderId, title: n.title, pinned: n.pinned, preview: String(n.text || '').slice(0, 160), hasInk: !!(n.ink && n.ink.strokes && n.ink.strokes.length), createdAt: n.createdAt, updatedAt: n.updatedAt, revision: n.revision }; }
function syncSummary() {
  const n = state.current; if (!n) return;
  const i = state.notes.findIndex(x => x.id === n.id);
  const s = summaryOf(n);
  if (i >= 0) state.notes[i] = s; else state.notes.unshift(s);
}

async function updateMeta(id, patch) {
  try {
    const r = await api('/api/notes/' + encodeURIComponent(id), { method: 'PUT', body: patch });
    const s = state.notes.find(x => x.id === id);
    if (s) Object.assign(s, patch, { revision: r.revision, updatedAt: r.updatedAt });
    if (state.current && state.current.id === id) Object.assign(state.current, patch, { revision: r.revision, updatedAt: r.updatedAt });
    renderTree(); renderMeta();
  } catch (err) { toast(err.message, { error: true }); }
}
async function moveNote(id, folderId, quiet) {
  if (state.current && state.current.id === id) await flushNote();
  await updateMeta(id, { folderId: folderId || null });
  if (folderId) { F().expanded[folderId] = true; folders.changed(); renderTree(); }
  if (!quiet) toast('Moved to ' + (folderId ? folderById(folderId).name : 'notes without a folder') + '.');
}
function moveSheet(n) {
  const s = sheet('Move “' + (n.title || 'Untitled note') + '”');
  const list = h('ul.list');
  const add = (id, label, depth) => list.append(h('li.list-row', h('button.btn.btn-ghost', { type: 'button', style: { paddingLeft: 10 + depth * 18 + 'px', width: '100%', justifyContent: 'flex-start' }, onclick: () => { s.close(); moveNote(n.id, id); } }, icon(id ? 'folder' : 'file', 16), label, (n.folderId || null) === id ? ' (current)' : '')));
  add(null, 'No folder', 0);
  const walk = (pid, depth) => { for (const f of childrenOf(pid)) { add(f.id, f.name, depth); walk(f.id, depth + 1); } };
  walk(null, 0);
  s.body.append(list);
  s.foot.append(h('button.btn', { type: 'button', text: 'Cancel', onclick: () => s.close() }));
}
async function deleteNote(n) {
  const ok = await confirmSheet('Delete “' + (n.title || 'Untitled note') + '”?', 'This permanently deletes the note, its text and its handwriting. It cannot be undone.', { confirmLabel: 'Delete note' });
  if (!ok) return;
  try {
    await api('/api/notes/' + encodeURIComponent(n.id), { method: 'DELETE' });
    state.notes = state.notes.filter(x => x.id !== n.id);
    if (state.current && state.current.id === n.id) { state.current = null; state.dirty = false; history.replaceState(null, '', '/margin/app'); document.title = 'Margin'; showNote(); }
    renderTree();
    toast('Note deleted.');
  } catch (err) { toast(err.message, { error: true }); }
}
async function fullNote(id) { if (state.current && state.current.id === id) { collect(); return state.current; } return (await api('/api/notes/' + encodeURIComponent(id))).note; }
async function exportImage(id) {
  try {
    const n = await fullNote(id);
    const height = Math.max(n.height || 1100, ...((n.ink && n.ink.strokes) || []).map(s => Math.max(...s.pts.filter((_, i) => i % 3 === 1)) / 10 + 60));
    const url = renderPage({ width: PAGE_W, height: Math.min(height, 12000), paper: n.paper, text: n.text, strokes: (n.ink && n.ink.strokes) || [], textLeft: n.paper === 'lined' ? 88 : 48 });
    const a = h('a', { href: url, download: (n.title || 'note').replace(/[^\w\- ]+/g, '').trim().slice(0, 60) + '.png', hidden: true });
    document.body.append(a); a.click(); a.remove();
  } catch (err) { toast(err.message, { error: true }); }
}
async function exportText(id) {
  try { const n = await fullNote(id); download((n.title || 'note').replace(/[^\w\- ]+/g, '').trim().slice(0, 60) + '.txt', (n.title || '') + '\n\n' + (n.text || ''), 'text/plain'); }
  catch (err) { toast(err.message, { error: true }); }
}

// ---------- editing and saving ----------
function collect() {
  const n = state.current;
  if (!n) return;
  n.text = els.text.value;
  n.ink = { strokes: ink.strokes };
}
function markDirty() {
  if (!state.current) return;
  state.dirty = true;
  saveLabel(els.saveState, 'pending');
  saveSoon();
}
const saveSoon = debounce(() => { void saveNote(); }, 900);
async function saveNote() {
  const n = state.current;
  if (!n || !state.dirty) return;
  if (state.saving) { await state.saving; if (!state.dirty) return; }
  collect();
  state.dirty = false;
  saveLabel(els.saveState, 'saving');
  const body = { text: n.text, ink: n.ink, height: n.height || 1100, paper: n.paper, baseRevision: n.revision };
  state.saving = api('/api/notes/' + encodeURIComponent(n.id), { method: 'PUT', body })
    .then(r => { n.revision = r.revision; n.updatedAt = r.updatedAt; syncSummary(); saveLabel(els.saveState, state.dirty ? 'pending' : 'saved'); renderMeta(); })
    .catch(err => {
      state.dirty = true;
      if (err.status === 409) { saveLabel(els.saveState, 'conflict'); toast('This note was changed on another device. Reload it to see the latest version (your unsaved edits here will be lost).', { error: true, action: () => reloadCurrent(true), actionLabel: 'Reload note', ms: 15000 }); }
      else { saveLabel(els.saveState, 'error'); toast('Could not save: ' + err.message, { error: true }); }
    })
    .finally(() => { state.saving = null; });
  await state.saving;
}
async function flushNote() { saveSoon.cancel(); if (state.dirty) await saveNote(); else if (state.saving) await state.saving; }
async function reloadCurrent(force) {
  const n = state.current; if (!n) return;
  if (state.dirty && !force) return;
  try {
    const fresh = (await api('/api/notes/' + encodeURIComponent(n.id))).note;
    if (!force && fresh.revision === n.revision) return;
    state.current = fresh; state.dirty = false;
    showNote();
    saveLabel(els.saveState, 'saved');
  } catch { /* keep what is on screen */ }
}

els.title.addEventListener('input', () => { if (state.current) { state.current.title = els.title.value; document.title = (els.title.value || 'Note') + ' — Margin'; saveTitle(); } });
const saveTitle = debounce(async () => {
  const n = state.current; if (!n) return;
  const title = els.title.value.trim() || 'Untitled note';
  try { const r = await api('/api/notes/' + encodeURIComponent(n.id), { method: 'PUT', body: { title } }); n.revision = r.revision; n.updatedAt = r.updatedAt; syncSummary(); renderTree(); }
  catch (err) { toast(err.message, { error: true }); }
}, 600);
els.title.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); els.text.focus(); } });
els.text.addEventListener('input', () => { sizePage(); markDirty(); });

function sizePage() {
  const n = state.current; if (!n) return;
  els.text.style.height = 'auto';
  els.text.style.height = Math.max(200, els.text.scrollHeight) + 'px';
  const need = Math.max(1100, n.height || 1100, els.text.offsetTop + els.text.offsetHeight + 160, ink.maxY() + 240);
  if (need !== n.height) n.height = Math.ceil(need / 32) * 32;
  els.page.style.minHeight = n.height + 'px';
}

// ---------- zoom ----------
const zoomSupported = CSS.supports('zoom', '1');
function setZoom(z, fit = false) {
  state.fit = fit;
  state.zoom = zoomSupported ? Math.max(0.4, Math.min(3, Math.round(z * 100) / 100)) : 1;
  els.page.style.zoom = String(state.zoom);
  ink.zoom = state.zoom;
  const label = els.toolbar.querySelector('.zoom-label');
  if (label) label.textContent = Math.round(state.zoom * 100) + '%';
  ink.layout();
}
function fitZoom() { return Math.min(1.4, Math.max(0.4, (els.scroller.clientWidth - 32) / PAGE_W)); }
function fitAndLayout() { if (!state.current) return; if (state.fit) setZoom(fitZoom(), true); else ink.layout(); }
new ResizeObserver(() => fitAndLayout()).observe(els.scroller);

// ---------- ink ----------
const ink = new InkLayer({
  note: els.note, scroller: els.scroller, page: els.page, base: els.ink, live: els.live,
  onChange: () => { markDirty(); updateUndo(); },
  onGrow: bottom => { const n = state.current; if (n && bottom > (n.height || 1100) - 260) { n.height = Math.ceil((bottom + 640) / 32) * 32; els.page.style.minHeight = n.height + 'px'; ink.layout(); } },
  onZoom: z => setZoom(z),
  onPenDetected: () => {
    if (state.mode !== 'write') setMode('write');
    if (ink.fingerDraws) toast('Pen detected. Fingers now scroll and zoom; only the pen draws.');
  },
});

// A pen touching the page in Type mode switches to writing, so you can just start writing.
els.page.addEventListener('pointerdown', e => {
  if (state.mode === 'type' && e.pointerType === 'pen' && e.target !== els.text) { e.preventDefault(); ink.penSeen = true; setMode('write'); toast('Switched to writing. Tap Type to go back to the keyboard.'); }
});

function setMode(mode) {
  state.mode = mode;
  els.note.classList.toggle('writing', mode === 'write');
  if (mode === 'write') els.text.blur();
  renderToolbar();
}
function toolButton(name, iconName, label, pressed, onclick) {
  return h('button.icon-btn', { type: 'button', 'aria-label': label, title: label, 'aria-pressed': String(!!pressed), onclick }, icon(iconName));
}
let undoBtn = null, redoBtn = null;
function updateUndo() { if (undoBtn) undoBtn.disabled = !ink.undoStack.length; if (redoBtn) redoBtn.disabled = !ink.redoStack.length; }
function persistPen() { F().pen = { tool: ink.tool, color: ink.color, size: ink.size }; F().fingerDraws = ink.fingerDraws; folders.changed(); }

function renderToolbar() {
  const tb = els.toolbar;
  tb.textContent = '';
  const seg = h('div.seg.mode-seg', { role: 'tablist', 'aria-label': 'Input mode' },
    h('button', { type: 'button', role: 'tab', 'aria-selected': String(state.mode === 'type'), onclick: () => setMode('type') }, icon('type', 16), 'Type'),
    h('button', { type: 'button', role: 'tab', 'aria-selected': String(state.mode === 'write'), onclick: () => setMode('write') }, icon('pen', 16), 'Write'));
  tb.append(seg, h('span.sep'));
  if (state.mode === 'write') {
    const tools = h('div.tool-group', { role: 'group', 'aria-label': 'Tools' },
      toolButton('pen', 'pen', 'Pen', !ink.eraser && ink.tool === 'pen', () => { ink.eraser = false; ink.tool = 'pen'; if (HIGHLIGHT_COLORS.includes(ink.color)) ink.color = INK_COLORS[0]; persistPen(); renderToolbar(); }),
      toolButton('pencil', 'pencil', 'Pencil (tilt shades)', !ink.eraser && ink.tool === 'pencil', () => { ink.eraser = false; ink.tool = 'pencil'; if (HIGHLIGHT_COLORS.includes(ink.color)) ink.color = INK_COLORS[0]; persistPen(); renderToolbar(); }),
      toolButton('highlighter', 'highlighter', 'Highlighter', !ink.eraser && ink.tool === 'highlighter', () => { ink.eraser = false; ink.tool = 'highlighter'; if (!HIGHLIGHT_COLORS.includes(ink.color)) ink.color = HIGHLIGHT_COLORS[0]; persistPen(); renderToolbar(); }),
      toolButton('eraser', 'eraser', 'Eraser (removes whole strokes)', ink.eraser, () => { ink.eraser = true; renderToolbar(); }));
    const palette = ink.tool === 'highlighter' ? HIGHLIGHT_COLORS : INK_COLORS;
    const colors = h('div.colors', { role: 'group', 'aria-label': 'Colour' }, palette.map(c => {
      const b = h('button.color', { type: 'button', 'aria-label': 'Colour ' + c, 'aria-pressed': String(ink.color === c && !ink.eraser), onclick: () => { ink.color = c; ink.eraser = false; persistPen(); renderToolbar(); } });
      b.style.background = c;
      return b;
    }));
    const size = h('input', { type: 'range', min: 0.8, max: 12, step: 0.2, value: ink.size, 'aria-label': 'Stroke size', title: 'Stroke size', oninput: e => { ink.size = Number(e.target.value); }, onchange: persistPen });
    undoBtn = toolButton('undo', 'undo', 'Undo stroke (Ctrl+Z)', false, () => ink.undo());
    redoBtn = toolButton('redo', 'redo', 'Redo stroke (Ctrl+Shift+Z)', false, () => ink.redo());
    const finger = toolButton('hand', 'hand', ink.fingerDraws ? 'Finger drawing is on (until a pen is used)' : 'Draw with finger', ink.fingerDraws, () => { ink.fingerDraws = !ink.fingerDraws; persistPen(); renderToolbar(); toast(ink.fingerDraws ? (ink.penSeen ? 'A pen was used on this page, so fingers keep scrolling. Reload to draw with a finger.' : 'Fingers draw now. Using a pen turns this off.') : 'Fingers scroll and zoom; only a pen or mouse draws.'); });
    tb.append(tools, h('span.sep'), colors, size, h('span.sep'), undoBtn, redoBtn, finger);
    els.live.classList.toggle('erasing', ink.eraser);
    updateUndo();
  }
  tb.append(h('span.spacer', { style: { flex: '1' } }));
  const paper = h('select.input', { 'aria-label': 'Paper style', title: 'Paper', onchange: e => { state.current.paper = e.target.value; els.page.className = 'page ' + e.target.value; markDirty(); }, value: state.current ? state.current.paper || 'lined' : 'lined' },
    ['lined', 'grid', 'dotted', 'blank'].map(p => h('option', { value: p, text: p[0].toUpperCase() + p.slice(1) })));
  tb.append(paper,
    toolButton('zout', 'zoomOut', 'Zoom out', false, () => setZoom(state.zoom / 1.15)),
    h('button.btn.btn-ghost.btn-sm.zoom-label', { type: 'button', title: 'Fit to width', text: Math.round(state.zoom * 100) + '%', onclick: () => setZoom(fitZoom(), true) }),
    toolButton('zin', 'zoomIn', 'Zoom in', false, () => setZoom(state.zoom * 1.15)),
    h('button.icon-btn', { type: 'button', 'aria-label': 'More note options', title: 'More', onclick: e => {
      const n = state.notes.find(x => x.id === state.current.id) || summaryOf(state.current);
      popover(e.currentTarget, [
        { label: n.pinned ? 'Unpin' : 'Pin to top', icon: 'pin', run: () => updateMeta(n.id, { pinned: !n.pinned }) },
        { label: 'Move to…', icon: 'folder', run: () => moveSheet(n) },
        { label: 'Clear handwriting', icon: 'eraser', run: () => { ink.clear(); toast('Handwriting cleared.', { action: () => ink.undo(), actionLabel: 'Undo' }); } },
        { label: 'Download as image', icon: 'download', run: () => exportImage(n.id) },
        { label: 'Download text', icon: 'file', run: () => exportText(n.id) },
        '-', { label: 'Delete note', icon: 'trash', danger: true, run: () => deleteNote(n) },
      ]);
    } }, icon('more')));
}

window.addEventListener('keydown', e => {
  if (!state.current) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); void flushNote(); return; }
  if (state.mode === 'write' && mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) ink.redo(); else ink.undo(); }
  else if (state.mode === 'write' && mod && e.key.toLowerCase() === 'y') { e.preventDefault(); ink.redo(); }
});

// ---------- start ----------
els.newNote.append(icon('plus', 16), 'New note');
els.newNote.addEventListener('click', () => newNote());
els.newFolder.append(icon('folder', 15), 'New folder');
els.newFolder.addEventListener('click', () => newFolder(null));

async function route(params) {
  if (params.get('new') === '1') { history.replaceState(null, '', '/margin/app'); await newNote(); return; }
  const id = params.get('note');
  if (id) await openNote(id);
}
onShellNavigate(params => { void route(params); });

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { void flushNote(); return; }
  loadNotes().then(() => {
    const s = state.current && state.notes.find(x => x.id === state.current.id);
    if (s && s.revision !== state.current.revision && !state.dirty && !state.saving) void reloadCurrent(false);
  }).catch(() => {});
});
window.addEventListener('pagehide', () => { if (state.dirty) void saveNote(); });

async function init() {
  try {
    await folders.load();
    ink.tool = (F().pen && F().pen.tool) || 'pen';
    ink.color = (F().pen && F().pen.color) || INK_COLORS[0];
    ink.size = (F().pen && F().pen.size) || 2.4;
    ink.fingerDraws = !!F().fingerDraws;
    setSidebar(F().sidebarOpen !== false && !narrowMq.matches, false);
    await loadNotes();
    await route(new URLSearchParams(location.search));
    if (!state.current) showNote();
  } catch (err) {
    toast('Margin could not load: ' + err.message, { error: true, ms: 20000 });
  }
}
init();
