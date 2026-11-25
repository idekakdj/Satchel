// Ledger: accounts, transactions, budgets, recurring entries, savings goals and reports.
// Amounts are stored as integer cents in one currency.
import { h, icon, toast, sheet, confirmSheet, uid, todayISO, fmtDate, download, pickFile, createDocStore, saveLabel, onShellNavigate, escapeCsv, parseCsv } from '/js/app-kit.js';

const $ = id => document.getElementById(id);
const COLORS = ['#14a37f', '#2a6fdb', '#f05a3c', '#e0a526', '#9b6bdf', '#e9617b', '#18a999', '#7cb518', '#c46b2d', '#5b5fe0', '#8a7d70', '#d1392b'];
const CURRENCIES = ['CAD', 'USD', 'EUR', 'GBP', 'AUD', 'NZD', 'JPY', 'CNY', 'INR', 'KRW', 'HKD', 'SGD', 'CHF', 'SEK', 'NOK', 'DKK', 'MXN', 'BRL', 'ZAR'];
const ACCOUNT_TYPES = { cash: 'Cash', chequing: 'Chequing', savings: 'Savings', credit: 'Credit card', other: 'Other' };
const EVERY = { weekly: 'Every week', biweekly: 'Every 2 weeks', monthly: 'Every month', yearly: 'Every year' };

function defaults() {
  const cat = (name, kind, color, budget = null) => ({ id: uid(), name, kind, color, budget });
  return {
    version: 1, currency: 'CAD', setup: false,
    accounts: [],
    categories: [
      cat('Groceries', 'expense', '#14a37f'), cat('Dining out', 'expense', '#f05a3c'), cat('Rent', 'expense', '#5b5fe0'),
      cat('Transport', 'expense', '#2a6fdb'), cat('Textbooks & supplies', 'expense', '#e0a526'), cat('Tuition', 'expense', '#9b6bdf'),
      cat('Subscriptions', 'expense', '#e9617b'), cat('Entertainment', 'expense', '#18a999'), cat('Health', 'expense', '#d1392b'),
      cat('Clothing', 'expense', '#c46b2d'), cat('Other', 'expense', '#8a7d70'),
      cat('Pay', 'income', '#1f8a4c'), cat('Scholarship', 'income', '#7cb518'), cat('Allowance', 'income', '#18a999'), cat('Gifts', 'income', '#e0a526'), cat('Other income', 'income', '#8a7d70'),
    ],
    transactions: [], recurring: [], goals: [],
  };
}
const store = createDocStore('ledger', {
  defaults, migrate: d => ({ ...defaults(), ...d }),
  onState: s => saveLabel($('save-state'), s),
  onConflict: () => toast('Ledger changed on another device.', { error: true, action: () => location.reload(), actionLabel: 'Reload' }),
});
const D = () => store.doc;
const state = { tab: 'overview', month: todayISO().slice(0, 7), filter: { account: '', category: '', q: '' } };

// ---------- helpers ----------
function fmt(cents, opts = {}) {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: D().currency, ...opts }).format((cents || 0) / 100); }
  catch { return ((cents || 0) / 100).toFixed(2); }
}
function parseAmount(text) {
  const clean = String(text).replace(/[^\d.,-]/g, '').replace(/,(?=\d{3}(\D|$))/g, '').replace(',', '.');
  const v = Math.round(Math.abs(parseFloat(clean)) * 100);
  return Number.isFinite(v) ? v : NaN;
}
const account = id => D().accounts.find(a => a.id === id) || null;
const category = id => D().categories.find(c => c.id === id) || null;
const monthLabel = m => new Date(m + '-15T12:00:00').toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
function shiftMonth(m, n) { const d = new Date(m + '-15T12:00:00'); d.setMonth(d.getMonth() + n); return d.toISOString().slice(0, 7); }
function balances() {
  const b = new Map(D().accounts.map(a => [a.id, a.opening || 0]));
  for (const t of D().transactions) {
    if (t.kind === 'expense' && b.has(t.accountId)) b.set(t.accountId, b.get(t.accountId) - t.amount);
    else if (t.kind === 'income' && b.has(t.accountId)) b.set(t.accountId, b.get(t.accountId) + t.amount);
    else if (t.kind === 'transfer') { if (b.has(t.accountId)) b.set(t.accountId, b.get(t.accountId) - t.amount); if (b.has(t.toAccountId)) b.set(t.toAccountId, b.get(t.toAccountId) + t.amount); }
  }
  return b;
}
function monthTotals(m) {
  let spent = 0, income = 0; const byCat = new Map();
  for (const t of D().transactions) {
    if (!t.date.startsWith(m)) continue;
    if (t.kind === 'expense') { spent += t.amount; byCat.set(t.categoryId, (byCat.get(t.categoryId) || 0) + t.amount); }
    else if (t.kind === 'income') income += t.amount;
  }
  return { spent, income, byCat };
}
function catChip(c) { const el = h('span.cat-chip', { text: (c ? c.name : '?').charAt(0).toUpperCase(), 'aria-hidden': 'true' }); el.style.background = c ? c.color : '#8a7d70'; return el; }
function changed() { store.changed(); render(); }

// ---------- recurring entries ----------
function nextDate(iso, every) {
  const d = new Date(iso + 'T12:00:00');
  if (every === 'weekly') d.setDate(d.getDate() + 7);
  else if (every === 'biweekly') d.setDate(d.getDate() + 14);
  else if (every === 'yearly') d.setFullYear(d.getFullYear() + 1);
  else { const day = d.getDate(); d.setDate(1); d.setMonth(d.getMonth() + 1); d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate())); }
  return todayISO(d);
}
function runRecurring() {
  const today = todayISO(); let made = 0;
  for (const r of D().recurring) {
    let guard = 0;
    while (r.next <= today && guard++ < 120) {
      D().transactions.push({ id: uid(), kind: r.kind, amount: r.amount, date: r.next, accountId: r.accountId, toAccountId: r.toAccountId || null, categoryId: r.categoryId || null, note: r.note || '', recurringId: r.id });
      r.next = nextDate(r.next, r.every); made++;
    }
  }
  if (made) { store.changed(); toast(`Added ${made} recurring ${made === 1 ? 'entry' : 'entries'}.`); }
}

// ---------- tabs ----------
const TABS = [['overview', 'Overview'], ['transactions', 'Transactions'], ['budgets', 'Budgets'], ['goals', 'Goals'], ['reports', 'Reports'], ['settings', 'Accounts & settings']];
function renderTabs() {
  const nav = $('tabs'); nav.textContent = '';
  for (const [k, label] of TABS) nav.append(h('button', { type: 'button', role: 'tab', 'aria-selected': String(state.tab === k), text: label, onclick: () => { state.tab = k; render(); } }));
}
function monthNav() {
  return h('div.month-nav',
    h('button.icon-btn', { type: 'button', 'aria-label': 'Previous month', onclick: () => { state.month = shiftMonth(state.month, -1); render(); } }, icon('chevronLeft')),
    h('span.label', { text: monthLabel(state.month) }),
    h('button.icon-btn', { type: 'button', 'aria-label': 'Next month', onclick: () => { state.month = shiftMonth(state.month, 1); render(); } }, icon('chevronRight')));
}
function render() {
  renderTabs();
  const v = $('view'); v.textContent = '';
  if (!D().setup) { v.append(setupView()); return; }
  ({ overview, transactions, budgets, goals, reports, settings })[state.tab](v);
}

// ---------- first run ----------
function setupView() {
  const name = h('input.input', { value: 'Chequing', maxlength: 60 });
  const type = h('select.input', Object.entries(ACCOUNT_TYPES).map(([k, l]) => h('option', { value: k, text: l })));
  type.value = 'chequing';
  const opening = h('input.input', { inputmode: 'decimal', placeholder: '0.00' });
  const cur = h('select.input', CURRENCIES.map(c => h('option', { value: c, text: c })));
  cur.value = D().currency;
  const form = h('form.card', { onsubmit: e => {
    e.preventDefault();
    const o = opening.value.trim() ? parseAmount(opening.value) : 0;
    if (Number.isNaN(o)) return toast('Enter the starting balance as a number.', { error: true });
    D().currency = cur.value;
    D().accounts.push({ id: uid(), name: name.value.trim() || 'Account', type: type.value, opening: o, archived: false });
    D().setup = true;
    changed();
  } },
  h('h2.serif', { text: 'Set up Ledger', style: { fontSize: '22px', marginBottom: '6px' } }),
  h('p.muted', { text: 'Start with one account. You can add cash, savings and cards later, and Ledger comes with categories you can change.' }),
  h('div.grid-2', h('label.field', h('span', { text: 'Account name' }), name), h('label.field', h('span', { text: 'Type' }), type)),
  h('div.grid-2', h('label.field', h('span', { text: 'Balance right now' }), opening), h('label.field', h('span', { text: 'Currency' }), cur)),
  h('button.btn.btn-accent', { type: 'submit', text: 'Start tracking' }));
  form.style.maxWidth = '560px';
  return form;
}

// ---------- overview ----------
function overview(v) {
  const { spent, income, byCat } = monthTotals(state.month);
  const bal = balances();
  const total = [...bal.values()].reduce((a, b) => a + b, 0);
  const budget = D().categories.filter(c => c.kind === 'expense').reduce((s, c) => s + (c.budget || 0), 0);
  v.append(h('div.page-head', h('div', h('h1', { text: 'Overview' }), h('p', { text: 'Where your money went this month.' })), monthNav()));
  v.append(h('div.stat-grid',
    h('div.stat', h('div.v', { text: fmt(spent) }), h('div.k', { text: 'Spent' })),
    h('div.stat', h('div.v', { text: fmt(income) }), h('div.k', { text: 'Income' })),
    h('div.stat', h('div.v', { text: fmt(income - spent) }), h('div.k', { text: 'Net this month' })),
    h('div.stat', h('div.v', { text: fmt(total) }), h('div.k', { text: 'Total balance' }))));
  const left = h('div');
  const bcard = h('section.card', h('div.card-head', h('h2', { text: 'Budgets' }), h('button.btn.btn-sm', { type: 'button', text: 'Edit budgets', onclick: () => { state.tab = 'budgets'; render(); } })));
  const withBudget = D().categories.filter(c => c.kind === 'expense' && c.budget);
  if (!withBudget.length) bcard.append(h('p.muted', { text: 'Set a monthly budget for a category to track it here.' }));
  if (budget) bcard.append(h('div.budget-row', h('div.top', h('span.grow', { text: 'All budgets' }), h('span.amount', { text: `${fmt(spent)} of ${fmt(budget)}` })), meter(spent, budget)));
  for (const c of withBudget) { const s = byCat.get(c.id) || 0; bcard.append(h('div.budget-row', h('div.top', catChip(c), h('span.grow', { text: c.name }), h('span.amount', { text: `${fmt(s)} / ${fmt(c.budget)}` })), meter(s, c.budget))); }
  const recent = D().transactions.filter(t => t.date.startsWith(state.month)).sort(byDateDesc).slice(0, 8);
  const rcard = h('section.card', h('div.card-head', h('h2', { text: 'Recent' }), h('button.btn.btn-sm', { type: 'button', text: 'All transactions', onclick: () => { state.tab = 'transactions'; render(); } })));
  rcard.append(recent.length ? h('ul.list', recent.map(txRow)) : h('p.muted', { text: 'Nothing logged this month yet.' }));
  left.append(bcard, rcard);
  const right = h('div');
  const acard = h('section.card', h('div.card-head', h('h2', { text: 'Accounts' }), h('button.btn.btn-sm', { type: 'button', text: 'Manage', onclick: () => { state.tab = 'settings'; render(); } })));
  acard.append(h('ul.list', D().accounts.filter(a => !a.archived).map(a => h('li.list-row', h('span.grow', h('div.title', { text: a.name }), h('div.sub', { text: ACCOUNT_TYPES[a.type] || 'Account' })), h('span.amount', { text: fmt(bal.get(a.id)) })))));
  right.append(acard);
  if (D().goals.length) {
    const gcard = h('section.card', h('div.card-head', h('h2', { text: 'Goals' })));
    for (const g of D().goals.slice(0, 3)) gcard.append(h('div.budget-row', h('div.top', h('span.grow', { text: g.name }), h('span.amount', { text: `${fmt(g.saved)} / ${fmt(g.target)}` })), meter(g.saved, g.target, true)));
    right.append(gcard);
  }
  v.append(h('div.layout-2', { style: { marginTop: '16px' } }, left, right));
}
function meter(value, max, good) {
  const fill = h('span' + (!good && value > max ? '.over' : ''));
  fill.style.width = (max > 0 ? Math.min(100, (value / max) * 100) : 0) + '%';
  return h('div.meter', { role: 'meter', 'aria-valuemin': 0, 'aria-valuemax': max, 'aria-valuenow': value }, fill);
}
const byDateDesc = (a, b) => b.date.localeCompare(a.date) || (b.created || 0) - (a.created || 0);
function txRow(t) {
  const c = category(t.categoryId), a = account(t.accountId);
  const title = t.kind === 'transfer' ? `Transfer to ${account(t.toAccountId)?.name || 'account'}` : (t.note || (c ? c.name : 'Uncategorized'));
  const sub = [fmtDate(t.date), t.kind === 'transfer' ? a?.name : (t.note && c ? c.name : null), t.kind !== 'transfer' ? a?.name : null, t.recurringId ? 'Recurring' : null].filter(Boolean).join(' · ');
  const sign = t.kind === 'expense' ? '−' : t.kind === 'income' ? '+' : '';
  const chip = t.kind === 'transfer' ? h('span.cat-chip', { style: { background: 'var(--surface-3)', color: 'var(--muted)' } }, icon('chevronRight', 16)) : catChip(c);
  return h('li.list-row.tx-row', { tabindex: 0, role: 'button', onclick: () => txSheet(t), onkeydown: e => { if (e.key === 'Enter') txSheet(t); } },
    chip, h('span.grow', h('div.title', { text: title }), h('div.sub', { text: sub })),
    h('span.amount.' + (t.kind === 'expense' ? 'out' : t.kind === 'income' ? 'in' : 'move'), { text: sign + fmt(t.amount) }));
}

// ---------- transactions ----------
function transactions(v) {
  v.append(h('div.page-head', h('div', h('h1', { text: 'Transactions' })), h('div.row', monthNav(),
    h('button.btn', { type: 'button', onclick: importCsv }, icon('upload', 16), 'Import CSV'),
    h('button.btn', { type: 'button', onclick: exportCsv }, icon('download', 16), 'Export'))));
  const f = state.filter;
  const acc = h('select.input', { 'aria-label': 'Account', onchange: e => { f.account = e.target.value; render(); } }, h('option', { value: '', text: 'All accounts' }), D().accounts.map(a => h('option', { value: a.id, text: a.name })));
  acc.value = f.account;
  const cat = h('select.input', { 'aria-label': 'Category', onchange: e => { f.category = e.target.value; render(); } }, h('option', { value: '', text: 'All categories' }), D().categories.map(c => h('option', { value: c.id, text: c.name })));
  cat.value = f.category;
  const q = h('input.input', { type: 'search', placeholder: 'Search notes', value: f.q, 'aria-label': 'Search transactions', oninput: e => { f.q = e.target.value; drawList(); } });
  v.append(h('div.filters', q, acc, cat));
  const listWrap = h('section.card');
  v.append(listWrap);
  function drawList() {
    listWrap.textContent = '';
    const query = f.q.trim().toLowerCase();
    const list = D().transactions.filter(t => t.date.startsWith(state.month) && (!f.account || t.accountId === f.account || t.toAccountId === f.account) && (!f.category || t.categoryId === f.category) && (!query || (t.note || '').toLowerCase().includes(query) || (category(t.categoryId)?.name || '').toLowerCase().includes(query))).sort(byDateDesc);
    if (!list.length) { listWrap.append(h('div.empty-state', h('h3', { text: 'No transactions' }), h('p', { text: 'Add one with the button at the top, or import a CSV from your bank.' }))); return; }
    let day = '', ul = null;
    for (const t of list) {
      if (t.date !== day) { day = t.date; listWrap.append(h('div.tx-day', { text: fmtDate(day, { weekday: 'long', month: 'long', day: 'numeric' }) })); ul = h('ul.list'); listWrap.append(ul); }
      ul.append(txRow(t));
    }
  }
  drawList();
}

function txSheet(existing, preset = {}) {
  if (!D().accounts.length) { toast('Add an account first.', { error: true }); state.tab = 'settings'; render(); return; }
  const t = existing ? { ...existing } : { id: uid(), kind: preset.kind || 'expense', amount: 0, date: todayISO(), accountId: D().accounts.find(a => !a.archived)?.id, toAccountId: null, categoryId: null, note: '' };
  const s = sheet(existing ? 'Edit transaction' : 'Add transaction');
  let kind = t.kind;
  const amount = h('input.input.big-amount', { inputmode: 'decimal', placeholder: '0.00', 'aria-label': 'Amount', value: t.amount ? (t.amount / 100).toFixed(2) : '' });
  const date = h('input.input', { type: 'date', value: t.date, required: true });
  const acctSel = (val, label) => { const el = h('select.input', { 'aria-label': label }, D().accounts.filter(a => !a.archived || a.id === val).map(a => h('option', { value: a.id, text: a.name }))); if (val) el.value = val; return el; };
  const acc = acctSel(t.accountId, 'Account');
  const to = acctSel(t.toAccountId || D().accounts.find(a => a.id !== t.accountId)?.id, 'To account');
  const cat = h('select.input', { 'aria-label': 'Category' });
  const note = h('input.input', { value: t.note || '', maxlength: 140, placeholder: 'e.g. Coffee with Sam' });
  const repeat = h('select.input', { 'aria-label': 'Repeat' }, h('option', { value: '', text: 'Does not repeat' }), Object.entries(EVERY).map(([k, l]) => h('option', { value: k, text: l })));
  const fillCats = () => { cat.textContent = ''; for (const c of D().categories.filter(c => c.kind === kind)) cat.append(h('option', { value: c.id, text: c.name })); if (t.categoryId && category(t.categoryId)?.kind === kind) cat.value = t.categoryId; };
  const seg = h('div.seg.kind-seg', { role: 'tablist' });
  const catField = h('label.field', h('span', { text: 'Category' }), cat), toField = h('label.field', h('span', { text: 'To account' }), to);
  const drawSeg = () => {
    seg.textContent = '';
    for (const [k, l] of [['expense', 'Expense'], ['income', 'Income'], ['transfer', 'Transfer']]) seg.append(h('button', { type: 'button', role: 'tab', 'aria-selected': String(kind === k), text: l, onclick: () => { kind = k; drawSeg(); fillCats(); } }));
    catField.hidden = kind === 'transfer'; toField.hidden = kind !== 'transfer';
  };
  drawSeg(); fillCats();
  const form = h('form', { onsubmit: e => {
    e.preventDefault();
    const cents = parseAmount(amount.value);
    if (!cents || Number.isNaN(cents) || cents > 1e11) return toast('Enter an amount greater than zero.', { error: true });
    if (kind === 'transfer' && acc.value === to.value) return toast('Choose two different accounts for a transfer.', { error: true });
    const value = { ...t, kind, amount: cents, date: date.value || todayISO(), accountId: acc.value, toAccountId: kind === 'transfer' ? to.value : null, categoryId: kind === 'transfer' ? null : cat.value, note: note.value.trim() };
    if (existing) Object.assign(D().transactions.find(x => x.id === t.id), value);
    else {
      value.created = Date.now();
      if (repeat.value) {
        const r = { id: uid(), kind, amount: cents, accountId: value.accountId, toAccountId: value.toAccountId, categoryId: value.categoryId, note: value.note, every: repeat.value, next: value.date };
        D().recurring.push(r);
        value.recurringId = r.id;
        r.next = nextDate(value.date, r.every);
      }
      if (D().transactions.length >= 20000) return toast('Ledger holds up to 20,000 transactions. Export and remove older ones first.', { error: true });
      D().transactions.push(value);
    }
    s.close(); state.month = value.date.slice(0, 7); changed();
    toast(existing ? 'Transaction updated.' : 'Transaction added.');
  } },
  seg,
  h('label.field', h('span', { text: 'Amount (' + D().currency + ')' }), amount),
  h('div.grid-2', h('label.field', h('span', { text: 'Date' }), date), h('label.field', h('span', { text: kind === 'transfer' ? 'From account' : 'Account' }), acc)),
  h('div.grid-2', catField, toField, existing ? null : h('label.field', h('span', { text: 'Repeat' }), repeat)),
  h('label.field', h('span', { text: 'Note' }), note));
  s.body.append(form);
  if (existing) s.foot.append(h('button.btn.btn-danger.left', { type: 'button', text: 'Delete', onclick: async () => {
    s.close();
    const removed = D().transactions.find(x => x.id === t.id);
    D().transactions = D().transactions.filter(x => x.id !== t.id); changed();
    toast('Transaction deleted.', { action: () => { D().transactions.push(removed); changed(); } });
  } }));
  s.foot.append(h('button.btn', { type: 'button', text: 'Cancel', onclick: () => s.close() }), h('button.btn.btn-accent', { type: 'button', text: existing ? 'Save' : 'Add', onclick: () => form.requestSubmit() }));
  setTimeout(() => amount.focus(), 30);
}

// ---------- CSV ----------
function exportCsv() {
  const rows = [['date', 'type', 'amount', 'account', 'to_account', 'category', 'note']];
  for (const t of D().transactions.slice().sort((a, b) => a.date.localeCompare(b.date))) rows.push([t.date, t.kind, (t.amount / 100).toFixed(2), account(t.accountId)?.name || '', account(t.toAccountId)?.name || '', category(t.categoryId)?.name || '', t.note || '']);
  download('ledger-transactions.csv', rows.map(r => r.map(escapeCsv).join(',')).join('\n'), 'text/csv');
}
async function importCsv() {
  const file = await pickFile('.csv,text/csv');
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) return toast('Choose a CSV under 5 MB.', { error: true });
  const rows = parseCsv(await file.text());
  if (rows.length < 2) return toast('That file has no rows to import.', { error: true });
  const head = rows[0].map(x => x.trim().toLowerCase());
  const col = (...names) => head.findIndex(x => names.some(n => x.includes(n)));
  const ci = { date: col('date'), amount: col('amount'), debit: col('debit', 'withdrawal'), credit: col('credit', 'deposit'), note: col('description', 'note', 'memo', 'payee', 'name'), category: col('category'), type: col('type') };
  if (ci.date < 0 || (ci.amount < 0 && ci.debit < 0 && ci.credit < 0)) return toast('The CSV needs a date column and an amount (or debit/credit) column.', { error: true });
  const s = sheet('Import transactions');
  const acc = h('select.input', D().accounts.map(a => h('option', { value: a.id, text: a.name })));
  const flip = h('input', { type: 'checkbox' });
  s.body.append(h('p', { text: `${rows.length - 1} rows found in ${file.name}.` }),
    h('label.field', h('span', { text: 'Import into account' }), acc),
    h('label.check', flip, 'Positive amounts are spending (some credit card exports do this)'),
    h('p.hint', { text: 'Rows are matched to your categories by name; anything else goes to Other. Duplicates of existing entries (same date, amount and note) are skipped.' }));
  s.foot.append(h('button.btn', { type: 'button', text: 'Cancel', onclick: () => s.close() }), h('button.btn.btn-accent', { type: 'button', text: 'Import', onclick: () => {
    const other = D().categories.find(c => c.name === 'Other' && c.kind === 'expense'), otherIn = D().categories.find(c => c.kind === 'income' && c.name === 'Other income');
    const seen = new Set(D().transactions.map(t => `${t.date}|${t.amount}|${t.note}`));
    let added = 0, skipped = 0;
    for (const r of rows.slice(1)) {
      const date = normalizeDate(r[ci.date]); if (!date) { skipped++; continue; }
      let signed;
      if (ci.amount >= 0) { const raw = String(r[ci.amount] || '').trim(); const neg = /^-|^\(|-$/.test(raw); signed = parseAmount(raw) * (neg ? -1 : 1); if (flip.checked) signed = -signed; }
      else { const debit = parseAmount(r[ci.debit] || '0') || 0, credit = parseAmount(r[ci.credit] || '0') || 0; signed = credit - debit; }
      if (!signed || Number.isNaN(signed)) { skipped++; continue; }
      const kind = (ci.type >= 0 && /income|credit|deposit/i.test(r[ci.type])) ? 'income' : (ci.type >= 0 && /expense|debit/i.test(r[ci.type])) ? 'expense' : signed > 0 ? 'income' : 'expense';
      const note = ci.note >= 0 ? String(r[ci.note] || '').trim().slice(0, 140) : '';
      const catName = ci.category >= 0 ? String(r[ci.category] || '').trim().toLowerCase() : '';
      const c = D().categories.find(x => x.kind === kind && x.name.toLowerCase() === catName) || (kind === 'income' ? otherIn : other);
      const t = { id: uid(), kind, amount: Math.abs(signed), date, accountId: acc.value, toAccountId: null, categoryId: c ? c.id : null, note, created: Date.now() };
      const key = `${t.date}|${t.amount}|${t.note}`;
      if (seen.has(key)) { skipped++; continue; }
      seen.add(key); D().transactions.push(t); added++;
      if (D().transactions.length >= 20000) break;
    }
    s.close(); changed();
    toast(`Imported ${added} transaction${added === 1 ? '' : 's'}${skipped ? `, skipped ${skipped}` : ''}.`);
  } }));
}
function normalizeDate(v) {
  const s = String(v || '').trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/.exec(s);
  if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; const a = +m[1], b = +m[2]; const [mo, d] = a > 12 ? [b, a] : [a, b]; return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`; }
  const d = new Date(s); return isNaN(d) ? null : todayISO(d);
}

// ---------- budgets and categories ----------
function budgets(v) {
  const { byCat } = monthTotals(state.month);
  v.append(h('div.page-head', h('div', h('h1', { text: 'Budgets & categories' }), h('p', { text: 'Set a monthly limit for any spending category. Leave it blank for no budget.' })), h('div.row', monthNav(), h('button.btn', { type: 'button', onclick: () => categorySheet() }, icon('plus', 16), 'Category'))));
  for (const kind of ['expense', 'income']) {
    const card = h('section.card', h('div.card-head', h('h2', { text: kind === 'expense' ? 'Spending' : 'Income' })));
    for (const c of D().categories.filter(c => c.kind === kind)) {
      const spent = byCat.get(c.id) || 0;
      const input = h('input.input', { inputmode: 'decimal', placeholder: 'No budget', value: c.budget ? (c.budget / 100).toFixed(2) : '', 'aria-label': 'Monthly budget for ' + c.name, style: { width: '130px', textAlign: 'right' }, onchange: e => { const val = e.target.value.trim(); const cents = val ? parseAmount(val) : null; if (val && Number.isNaN(cents)) { toast('Enter a number.', { error: true }); return; } c.budget = cents || null; changed(); } });
      const row = h('div.budget-row', h('div.top', catChip(c), h('span.grow', { text: c.name }), kind === 'expense' ? h('span.small.muted.num', { text: fmt(spent) + ' spent' }) : null, kind === 'expense' ? input : null,
        h('button.icon-btn', { type: 'button', 'aria-label': 'Edit ' + c.name, onclick: () => categorySheet(c) }, icon('edit', 16))));
      if (kind === 'expense' && c.budget) row.append(meter(spent, c.budget));
      card.append(row);
    }
    v.append(card);
  }
}
function swatches(current, onPick) {
  const wrap = h('div.swatch-pick', { role: 'group', 'aria-label': 'Colour' });
  const draw = sel => { wrap.textContent = ''; for (const c of COLORS) { const b = h('button', { type: 'button', 'aria-label': 'Colour ' + c, 'aria-pressed': String(c === sel), onclick: () => { onPick(c); draw(c); } }); b.style.background = c; wrap.append(b); } };
  draw(current);
  return wrap;
}
function categorySheet(c) {
  const s = sheet(c ? 'Edit category' : 'New category');
  let color = c ? c.color : COLORS[D().categories.length % COLORS.length];
  const name = h('input.input', { value: c ? c.name : '', maxlength: 40, required: true });
  const kind = h('select.input', h('option', { value: 'expense', text: 'Spending' }), h('option', { value: 'income', text: 'Income' }));
  kind.value = c ? c.kind : 'expense';
  kind.disabled = !!c;
  const form = h('form', { onsubmit: e => {
    e.preventDefault();
    const n = name.value.trim(); if (!n) return;
    if (c) Object.assign(c, { name: n, color });
    else D().categories.push({ id: uid(), name: n, kind: kind.value, color, budget: null });
    s.close(); changed();
  } }, h('label.field', h('span', { text: 'Name' }), name), h('label.field', h('span', { text: 'Type' }), kind), h('div.field', h('span.label', { text: 'Colour' }), swatches(color, x => { color = x; })));
  s.body.append(form);
  if (c) s.foot.append(h('button.btn.btn-danger.left', { type: 'button', text: 'Delete', onclick: async () => {
    const used = D().transactions.filter(t => t.categoryId === c.id).length;
    if (!(await confirmSheet('Delete “' + c.name + '”?', used ? `${used} transactions use it. They will move to “Other”.` : 'This category is not used yet.', { confirmLabel: 'Delete category' }))) return;
    const other = D().categories.find(x => x.kind === c.kind && x.id !== c.id && /^other/i.test(x.name)) || D().categories.find(x => x.kind === c.kind && x.id !== c.id);
    for (const t of D().transactions) if (t.categoryId === c.id) t.categoryId = other ? other.id : null;
    D().categories = D().categories.filter(x => x.id !== c.id);
    s.close(); changed();
  } }));
  s.foot.append(h('button.btn', { type: 'button', text: 'Cancel', onclick: () => s.close() }), h('button.btn.btn-accent', { type: 'button', text: 'Save', onclick: () => form.requestSubmit() }));
}

// ---------- goals ----------
function goals(v) {
  v.append(h('div.page-head', h('div', h('h1', { text: 'Savings goals' }), h('p', { text: 'Put money aside for something and watch it fill up.' })), h('button.btn', { type: 'button', onclick: () => goalSheet() }, icon('plus', 16), 'New goal')));
  if (!D().goals.length) { v.append(h('div.card', h('div.empty-state', h('h3', { text: 'No goals yet' }), h('p', { text: 'A trip, a new laptop, an emergency fund: give it a name and a target.' })))); return; }
  const cards = h('div.cards');
  for (const g of D().goals) {
    const pct = g.target ? Math.min(100, Math.round(g.saved / g.target * 100)) : 0;
    const add = h('input.input', { inputmode: 'decimal', placeholder: 'Amount', 'aria-label': 'Amount to add to ' + g.name, style: { width: '120px' } });
    cards.append(h('section.card.goal-card', h('div.card-head', h('h2', { text: g.name }), h('button.icon-btn', { type: 'button', 'aria-label': 'Edit goal', onclick: () => goalSheet(g) }, icon('edit', 16))),
      h('div.amount', { text: `${fmt(g.saved)} of ${fmt(g.target)}` }), meter(g.saved, g.target, true),
      h('p.small.muted', { text: pct >= 100 ? 'Goal reached. Nicely done.' : `${pct}% there${g.by ? ' · by ' + fmtDate(g.by, { month: 'short', day: 'numeric', year: 'numeric' }) : ''}${g.by && g.target > g.saved ? ' · about ' + fmt(perMonth(g)) + ' a month' : ''}` }),
      h('div.row', add, h('button.btn.btn-sm', { type: 'button', text: 'Add', onclick: () => { const c = parseAmount(add.value); if (!c) return; g.saved += c; changed(); } }), h('button.btn.btn-sm.btn-ghost', { type: 'button', text: 'Withdraw', onclick: () => { const c = parseAmount(add.value); if (!c) return; g.saved = Math.max(0, g.saved - c); changed(); } }))));
  }
  v.append(cards);
}
function perMonth(g) { const months = Math.max(1, (new Date(g.by + 'T12:00:00') - new Date()) / (30.44 * 86400000)); return Math.ceil((g.target - g.saved) / months); }
function goalSheet(g) {
  const s = sheet(g ? 'Edit goal' : 'New goal');
  const name = h('input.input', { value: g ? g.name : '', maxlength: 60, required: true, placeholder: 'e.g. Summer trip' });
  const target = h('input.input', { inputmode: 'decimal', value: g ? (g.target / 100).toFixed(2) : '', required: true });
  const saved = h('input.input', { inputmode: 'decimal', value: g ? (g.saved / 100).toFixed(2) : '0' });
  const by = h('input.input', { type: 'date', value: g && g.by ? g.by : '' });
  const form = h('form', { onsubmit: e => {
    e.preventDefault();
    const t = parseAmount(target.value), sv = parseAmount(saved.value || '0');
    if (!t || Number.isNaN(t)) return toast('Enter a target amount.', { error: true });
    const value = { name: name.value.trim() || 'Goal', target: t, saved: Number.isNaN(sv) ? 0 : sv, by: by.value || null };
    if (g) Object.assign(g, value); else D().goals.push({ id: uid(), ...value });
    s.close(); changed();
  } }, h('label.field', h('span', { text: 'Name' }), name), h('div.grid-2', h('label.field', h('span', { text: 'Target' }), target), h('label.field', h('span', { text: 'Saved so far' }), saved)), h('label.field', h('span', { text: 'Target date (optional)' }), by));
  s.body.append(form);
  if (g) s.foot.append(h('button.btn.btn-danger.left', { type: 'button', text: 'Delete', onclick: async () => { if (await confirmSheet('Delete this goal?', 'The goal and its progress are removed. Your transactions are not affected.', { confirmLabel: 'Delete goal' })) { D().goals = D().goals.filter(x => x.id !== g.id); s.close(); changed(); } } }));
  s.foot.append(h('button.btn', { type: 'button', text: 'Cancel', onclick: () => s.close() }), h('button.btn.btn-accent', { type: 'button', text: 'Save', onclick: () => form.requestSubmit() }));
}

// ---------- reports ----------
function svg(tag, attrs = {}, ...kids) { const el = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); el.append(...kids); return el; }
function reports(v) {
  v.append(h('div.page-head', h('div', h('h1', { text: 'Reports' }), h('p', { text: 'Spending by category, and six months of income against spending.' })), monthNav()));
  const { byCat, spent } = monthTotals(state.month);
  const card = h('section.card', h('div.card-head', h('h2', { text: 'Spending by category · ' + monthLabel(state.month) }), h('span.amount', { text: fmt(spent) })));
  const rows = [...byCat.entries()].map(([id, amt]) => ({ c: category(id), amt })).sort((a, b) => b.amt - a.amt);
  if (!rows.length) card.append(h('p.muted', { text: 'No spending recorded this month.' }));
  const max = rows.length ? rows[0].amt : 1;
  const bars = h('div.bars');
  for (const r of rows) {
    const fill = h('span.fill'); fill.style.width = (r.amt / max * 100) + '%'; fill.style.background = r.c ? r.c.color : '#8a7d70';
    bars.append(h('div.bar-row', h('span.name', { text: r.c ? r.c.name : 'Uncategorized' }), h('div.track', fill), h('span.amount', { text: `${fmt(r.amt)} · ${Math.round(r.amt / spent * 100)}%` })));
  }
  card.append(bars);
  v.append(card);

  const months = Array.from({ length: 6 }, (_, i) => shiftMonth(state.month, i - 5));
  const data = months.map(m => ({ m, ...monthTotals(m) }));
  const top = Math.max(1, ...data.map(d => Math.max(d.spent, d.income)));
  const W = 640, H = 240, L = 56, B = 28, T = 10, bw = (W - L - 10) / months.length;
  const chart = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'trend', role: 'img', 'aria-label': 'Income and spending for the last six months' });
  for (let i = 0; i <= 4; i++) {
    const y = T + (H - B - T) * (1 - i / 4);
    chart.append(svg('line', { x1: L, x2: W - 6, y1: y, y2: y, class: 'grid-line' }), svg('text', { x: L - 8, y: y + 4, 'text-anchor': 'end' }, fmt(top * i / 4, { minimumFractionDigits: 0, maximumFractionDigits: 0 })));
  }
  data.forEach((d, i) => {
    const x = L + i * bw + bw * 0.18, w = bw * 0.3, sc = v2 => (H - B - T) * v2 / top;
    const inc = svg('rect', { x, y: H - B - sc(d.income), width: w, height: Math.max(0, sc(d.income)), rx: 3, fill: '#1f8a4c' });
    const sp = svg('rect', { x: x + w + 3, y: H - B - sc(d.spent), width: w, height: Math.max(0, sc(d.spent)), rx: 3, fill: '#f05a3c' });
    inc.append(svg('title', {}, `Income ${fmt(d.income)}`)); sp.append(svg('title', {}, `Spending ${fmt(d.spent)}`));
    chart.append(inc, sp, svg('text', { x: x + w, y: H - 8, 'text-anchor': 'middle' }, new Date(d.m + '-15T12:00:00').toLocaleDateString(undefined, { month: 'short' })));
  });
  const legend = h('div.legend', h('span', h('i', { style: { background: '#1f8a4c' } }), 'Income'), h('span', h('i', { style: { background: '#f05a3c' } }), 'Spending'));
  const table = h('table.sr-only', h('caption', { text: 'Income and spending by month' }), h('tr', h('th', { text: 'Month' }), h('th', { text: 'Income' }), h('th', { text: 'Spending' })), data.map(d => h('tr', h('td', { text: monthLabel(d.m) }), h('td', { text: fmt(d.income) }), h('td', { text: fmt(d.spent) }))));
  v.append(h('section.card', h('div.card-head', h('h2', { text: 'Six-month trend' })), chart, legend, table));
}

// ---------- accounts and settings ----------
function settings(v) {
  const bal = balances();
  v.append(h('div.page-head', h('div', h('h1', { text: 'Accounts & settings' })), h('button.btn', { type: 'button', onclick: () => accountSheet() }, icon('plus', 16), 'Account')));
  const card = h('section.card', h('div.card-head', h('h2', { text: 'Accounts' })));
  card.append(h('ul.list', D().accounts.map(a => h('li.list-row', h('span.grow', h('div.title', { text: a.name + (a.archived ? ' (archived)' : '') }), h('div.sub', { text: ACCOUNT_TYPES[a.type] || 'Account' })), h('span.amount', { text: fmt(bal.get(a.id)) }), h('button.icon-btn', { type: 'button', 'aria-label': 'Edit ' + a.name, onclick: () => accountSheet(a) }, icon('edit', 16))))));
  v.append(card);
  const rcard = h('section.card', h('div.card-head', h('h2', { text: 'Recurring entries' })));
  if (!D().recurring.length) rcard.append(h('p.muted', { text: 'Choose “Repeat” when adding a transaction to make it recurring (rent, pay days, subscriptions).' }));
  rcard.append(h('ul.list', D().recurring.map(r => h('li.list-row', h('span.grow', h('div.title', { text: (r.note || category(r.categoryId)?.name || (r.kind === 'transfer' ? 'Transfer' : 'Entry')) }), h('div.sub', { text: `${EVERY[r.every]} · next ${fmtDate(r.next, { month: 'short', day: 'numeric', year: 'numeric' })} · ${account(r.accountId)?.name || ''}` })),
    h('span.amount', { text: (r.kind === 'income' ? '+' : r.kind === 'expense' ? '−' : '') + fmt(r.amount) }),
    h('button.icon-btn', { type: 'button', 'aria-label': 'Stop repeating', title: 'Stop repeating', onclick: async () => { if (await confirmSheet('Stop this recurring entry?', 'Entries already added stay in your transactions.', { confirmLabel: 'Stop repeating' })) { D().recurring = D().recurring.filter(x => x.id !== r.id); changed(); } } }, icon('trash', 16))))));
  v.append(rcard);
  const cur = h('select.input', { style: { width: 'auto' }, onchange: e => { D().currency = e.target.value; changed(); } }, CURRENCIES.map(c => h('option', { value: c, text: c })));
  cur.value = D().currency;
  v.append(h('section.card', h('div.card-head', h('h2', { text: 'Currency' })), h('div.row', cur, h('span.hint', { text: 'Changing the currency only changes how amounts are shown; it does not convert them.' }))));
  v.append(h('section.card', h('div.card-head', h('h2', { text: 'Your data' })), h('div.row', h('button.btn', { type: 'button', onclick: exportCsv }, icon('download', 16), 'Export transactions (CSV)'), h('button.btn', { type: 'button', onclick: () => download('ledger-backup.json', JSON.stringify(D(), null, 1), 'application/json') }, icon('download', 16), 'Full backup (JSON)'))));
}
function accountSheet(a) {
  const s = sheet(a ? 'Edit account' : 'New account');
  const name = h('input.input', { value: a ? a.name : '', maxlength: 60, required: true });
  const type = h('select.input', Object.entries(ACCOUNT_TYPES).map(([k, l]) => h('option', { value: k, text: l })));
  type.value = a ? a.type : 'cash';
  const opening = h('input.input', { inputmode: 'decimal', value: a ? ((a.opening || 0) / 100).toFixed(2) : '' });
  const archived = h('input', { type: 'checkbox', checked: !!(a && a.archived) });
  const form = h('form', { onsubmit: e => {
    e.preventDefault();
    const raw = opening.value.trim(); const neg = raw.startsWith('-');
    const o = raw ? parseAmount(raw) * (neg ? -1 : 1) : 0;
    if (Number.isNaN(o)) return toast('Enter the starting balance as a number.', { error: true });
    const value = { name: name.value.trim() || 'Account', type: type.value, opening: o, archived: archived.checked };
    if (a) Object.assign(a, value); else D().accounts.push({ id: uid(), ...value });
    s.close(); changed();
  } }, h('div.grid-2', h('label.field', h('span', { text: 'Name' }), name), h('label.field', h('span', { text: 'Type' }), type)),
  h('label.field', h('span', { text: 'Starting balance (negative for money owed on a card)' }), opening), a ? h('label.check', archived, 'Archived (hidden from new transactions)') : null);
  s.body.append(form);
  if (a) s.foot.append(h('button.btn.btn-danger.left', { type: 'button', text: 'Delete', onclick: async () => {
    const used = D().transactions.some(t => t.accountId === a.id || t.toAccountId === a.id);
    if (used) return toast('This account has transactions. Archive it instead.', { error: true });
    if (await confirmSheet('Delete “' + a.name + '”?', 'The account is removed.', { confirmLabel: 'Delete account' })) { D().accounts = D().accounts.filter(x => x.id !== a.id); s.close(); changed(); }
  } }));
  s.foot.append(h('button.btn', { type: 'button', text: 'Cancel', onclick: () => s.close() }), h('button.btn.btn-accent', { type: 'button', text: 'Save', onclick: () => form.requestSubmit() }));
}

// ---------- start ----------
$('add-btn').append(icon('plus', 16), 'Add');
$('add-btn').addEventListener('click', () => { if (!D().setup) return; txSheet(null); });
function route(params) {
  const add = params.get('add');
  if (add && D().setup) txSheet(null, { kind: ['expense', 'income', 'transfer'].includes(add) ? add : 'expense' });
  history.replaceState(null, '', '/ledger/app');
}
onShellNavigate(route);
(async () => {
  try {
    await store.load();
    runRecurring();
    render();
    route(new URLSearchParams(location.search));
  } catch (err) { toast('Ledger could not load: ' + err.message, { error: true, ms: 20000 }); }
})();
