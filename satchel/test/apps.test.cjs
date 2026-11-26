// Satchel apps suite: sign-in gating, landing pages, cross-account isolation, CSRF, revision
// guards and validation for Almanac, Margin, Ledger, Stride and Tunnel. Uses a temporary data
// directory and never touches real accounts.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'satchel-apps-'));
process.env.SATCHEL_DATA_DIR = temp;
process.env.SATCHEL_EMAIL_DNS_CHECK = 'off';
process.env.SATCHEL_EMAIL_VERIFICATION = 'off';
const app = require('../server/index');
const sec = require('../server/security');
const { db } = require('../server/store');

const ROOT = path.join(__dirname, '..', '..');
let server, base;
before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await new Promise(r => server.close(r)); fs.rmSync(temp, { recursive: true, force: true }); });

function resetLimits() {
  for (const l of [sec.loginLimiter, sec.registerLimiter, sec.authLimiter, sec.sensitiveLimiter, sec.apiLimiter, sec.writeLimiter, sec.pageLimiter]) l.resetKey('127.0.0.1');
}
async function call(url, { method = 'GET', body, cookie, headers = {} } = {}) {
  const h = { 'X-Requested-With': 'test', ...headers };
  if (cookie) h.Cookie = cookie;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const res = await fetch(base + url, { method, headers: h, redirect: 'manual', body: body === undefined ? undefined : JSON.stringify(body) });
  let data = null; try { data = await res.clone().json(); } catch { /* not JSON */ }
  return { res, status: res.status, data };
}
let n = 0;
async function account() {
  resetLimits();
  const i = ++n;
  const r = await call('/api/auth/register', { method: 'POST', body: { name: 'App Tester', email: `apps${i}@example.com`, password: 'Violet-Harbor-Lamp-42', acceptTerms: true } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return { cookie: r.res.headers.get('set-cookie').split(';')[0], id: r.data.user.id };
}
const APPS = ['almanac', 'margin', 'ledger', 'stride', 'tunnel'];
const APP_PAGES = ['/almanac/app/', '/margin/app', '/ledger/app', '/stride/app', '/tunnel/app'];

test('landing pages are public; signed-in visitors go to the dashboard', async () => {
  resetLimits();
  for (const a of APPS) {
    const r = await call('/' + a);
    assert.equal(r.status, 200, a);
    assert.match(await r.res.text(), /Satchel/);
  }
  assert.equal((await call('/')).status, 200);
  const { cookie } = await account();
  for (const a of APPS) {
    const r = await call('/' + a, { cookie });
    assert.equal(r.status, 302, a);
    assert.equal(r.res.headers.get('location'), '/');
  }
  const home = await call('/', { cookie });
  assert.equal(home.status, 200);
  assert.match(await home.res.text(), /id="sb-nav"/);
});

test('every app page and data API requires sign-in', async () => {
  resetLimits();
  for (const p of APP_PAGES) {
    const r = await call(p);
    assert.equal(r.status, 302, p);
    assert.match(r.res.headers.get('location'), /^\/auth\?next=/);
  }
  for (const [method, url] of [['GET', '/api/notes'], ['POST', '/api/notes'], ['GET', '/api/apps/ledger'], ['PUT', '/api/apps/stride'], ['POST', '/api/almanac/rpc'], ['GET', '/api/dashboard']]) {
    const r = await call(url, { method, body: method === 'GET' ? undefined : {} });
    assert.equal(r.status, 401, `${method} ${url}`);
  }
});

test('internal files are never served; public assets are', async () => {
  resetLimits();
  for (const p of ['/almanac/src/server/service.ts', '/almanac/server/almanac-service.cjs', '/almanac/package.json', '/almanac/node_modules/react/package.json', '/satchel/server/index.js', '/margin/app.html/../../satchel/.env.example', '/stride/data/../js/stride.js/../../app.html']) {
    const r = await call(p);
    assert.notEqual(r.status, 200, p);
  }
  for (const p of ['/margin/js/margin.js', '/stride/data/foods.json', '/tunnel/js/wg.js', '/ledger/css/ledger.css', '/css/app-kit.css', '/almanac/img/icon.svg']) {
    assert.equal((await call(p)).status, 200, p);
  }
});

test('notes: create, edit with revision guard, search, and no cross-account access', async () => {
  const a = await account(), b = await account();
  const made = await call('/api/notes', { method: 'POST', cookie: a.cookie, body: { title: 'Lecture 1', paper: 'grid' } });
  assert.equal(made.status, 201);
  const id = made.data.note.id;
  let r = await call('/api/notes/' + id, { method: 'PUT', cookie: a.cookie, body: { text: 'Mitochondria is the powerhouse', ink: { strokes: [{ id: 's1', tool: 'pen', color: '#1f1a15', size: 2, pts: [100, 200, 500, 140, 260, 700] }] }, baseRevision: 0 } });
  assert.equal(r.status, 200);
  assert.equal(r.data.revision, 1);
  r = await call('/api/notes/' + id, { method: 'PUT', cookie: a.cookie, body: { text: 'stale', baseRevision: 0 } });
  assert.equal(r.status, 409, 'stale revision is refused');
  r = await call('/api/notes/' + id, { method: 'PUT', cookie: a.cookie, body: { text: 'no base' } });
  assert.equal(r.status, 400, 'content changes need a base revision');
  r = await call('/api/notes?q=powerhouse', { cookie: a.cookie });
  assert.deepEqual(r.data.notes.map(x => x.id), [id]);
  r = await call('/api/notes/' + id, { cookie: a.cookie });
  assert.equal(r.data.note.ink.strokes.length, 1);
  for (const [method, body] of [['GET'], ['PUT', { title: 'mine now' }], ['DELETE']]) {
    r = await call('/api/notes/' + id, { method, cookie: b.cookie, body });
    assert.equal(r.status, 404, `${method} by another account`);
  }
  assert.equal((await call('/api/notes', { cookie: b.cookie })).data.notes.length, 0);
});

test('notes: bad ink, bidi titles and oversize text are refused', async () => {
  const a = await account();
  const id = (await call('/api/notes', { method: 'POST', cookie: a.cookie, body: {} })).data.note.id;
  for (const ink of [{ strokes: [{ id: 'x', tool: 'laser', color: '#000000', size: 2, pts: [1, 2, 3] }] }, { strokes: [{ id: 'x', tool: 'pen', color: 'red', size: 2, pts: [1, 2, 3] }] }, { strokes: [{ id: 'x', tool: 'pen', color: '#000000', size: 2, pts: [1, 2] }] }, { strokes: [{ id: 'x', tool: 'pen', color: '#000000', size: 2, pts: [1.5, 2, 3] }] }]) {
    const r = await call('/api/notes/' + id, { method: 'PUT', cookie: a.cookie, body: { ink, baseRevision: 0 } });
    assert.equal(r.status, 400, JSON.stringify(ink));
  }
  assert.equal((await call('/api/notes/' + id, { method: 'PUT', cookie: a.cookie, body: { title: 'evil‮name' } })).status, 400);
  assert.equal((await call('/api/notes/' + id, { method: 'PUT', cookie: a.cookie, body: { text: 'x'.repeat(500 * 1024 + 1), baseRevision: 0 } })).status, 400);
});

test('app documents: revision guard, validation, size limit and isolation', async () => {
  const a = await account(), b = await account();
  let r = await call('/api/apps/ledger', { cookie: a.cookie });
  assert.deepEqual(r.data, { document: null, revision: 0, updatedAt: null });
  const doc = { version: 1, currency: 'CAD', setup: true, accounts: [{ id: 'a1', name: 'Chequing', opening: 125040 }], transactions: [{ id: 't1', kind: 'expense', amount: 4218, date: '2026-11-25', accountId: 'a1', created: Date.now() }] };
  r = await call('/api/apps/ledger', { method: 'PUT', cookie: a.cookie, body: { document: doc, baseRevision: 0 } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.revision, 1);
  r = await call('/api/apps/ledger', { method: 'PUT', cookie: a.cookie, body: { document: doc, baseRevision: 0 } });
  assert.equal(r.status, 409, 'stale save refused');
  assert.equal((await call('/api/apps/ledger', { cookie: b.cookie })).data.document, null, 'other accounts see nothing');
  assert.equal((await call('/api/apps/unknown', { cookie: a.cookie })).status, 404);
  for (const bad of [[], 'text', { deep: JSON.parse('['.repeat(30) + ']'.repeat(30)) }, JSON.parse('{"__proto__": {"x": 1}}')]) {
    r = await call('/api/apps/stride', { method: 'PUT', cookie: a.cookie, body: { document: bad, baseRevision: 0 } });
    assert.equal(r.status, 400, JSON.stringify(bad));
  }
  r = await call('/api/apps/tunnel', { method: 'PUT', cookie: a.cookie, body: { document: { profiles: [], pad: 'x'.repeat(600 * 1024) }, baseRevision: 0 } });
  assert.equal(r.status, 413);
});

test('CSRF: cross-site writes to the new APIs are refused', async () => {
  const a = await account();
  const attempts = [
    ['/api/notes', 'POST', {}],
    ['/api/apps/ledger', 'PUT', { document: {}, baseRevision: 0 }],
    ['/api/almanac/rpc', 'POST', { command: 'snapshot', payload: {} }],
  ];
  for (const [url, method, body] of attempts) {
    let r = await call(url, { method, cookie: a.cookie, body, headers: { Origin: 'https://evil.example' } });
    assert.equal(r.status, 403, url + ' foreign origin');
    r = await call(url, { method, cookie: a.cookie, body, headers: { 'Sec-Fetch-Site': 'cross-site' } });
    assert.equal(r.status, 403, url + ' cross-site');
    const res = await fetch(base + url, { method, headers: { Cookie: a.cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(res.status, 403, url + ' missing header');
  }
});

test('Almanac: each account has its own calendar; validation errors are plain', { skip: !fs.existsSync(path.join(ROOT, 'almanac', 'server', 'almanac-service.cjs')) && 'run npm run build in almanac/ first' }, async () => {
  const a = await account(), b = await account();
  const rpc = (cookie, command, payload) => call('/api/almanac/rpc', { method: 'POST', cookie, body: { command, payload } });
  let r = await rpc(a.cookie, 'snapshot', {});
  assert.equal(r.status, 200);
  assert.equal(r.data.ok, true);
  assert.equal(r.data.result.session.uid, a.id);
  const item = { id: '3f1f8c3e-8f0a-4b6c-9c51-6a8e2d4b7a10', kind: 'item', title: 'Midterm', itemType: 'exam', timing: { mode: 'timed', start: '2026-12-02T14:00:00Z', end: '2026-12-02T16:00:00Z', zone: 'America/Toronto' } };
  r = await rpc(a.cookie, 'save', item);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(r.data.result.undoToken);
  r = await rpc(a.cookie, 'snapshot', {});
  assert.ok(r.data.result.records.some(x => x.id === item.id));
  r = await rpc(b.cookie, 'snapshot', {});
  assert.ok(!r.data.result.records.some(x => x.id === item.id), 'account B cannot see account A');
  r = await rpc(b.cookie, 'remove', { id: item.id });
  assert.equal(r.status, 400, 'account B cannot delete account A items');
  r = await rpc(a.cookie, 'save', { ...item, title: '' });
  assert.equal(r.status, 400);
  assert.equal(r.data.ok, false);
  assert.doesNotMatch(r.data.error, /^\[/, 'zod issue lists are not shown raw');
  r = await rpc(a.cookie, 'auth.signOut', {});
  assert.equal(r.status, 400, 'desktop-only commands are not available');
  r = await rpc(a.cookie, 'backup', {});
  assert.match(r.data.result.text, /cc-lime-backup/, 'backups stay compatible with C.C. Lime');
  const d = await call('/api/dashboard', { cookie: a.cookie });
  assert.equal(d.status, 200);
  assert.ok(Array.isArray(d.data.almanac.upcoming));
});

test('account export and deletion cover every app', async () => {
  const a = await account();
  await call('/api/notes', { method: 'POST', cookie: a.cookie, body: { title: 'Keep me' } });
  await call('/api/apps/stride', { method: 'PUT', cookie: a.cookie, body: { document: { version: 1, goals: { kcal: 2000 } }, baseRevision: 0 } });
  resetLimits();
  const exp = await call('/api/account/export', { cookie: a.cookie });
  assert.equal(exp.status, 200);
  assert.equal(exp.data.notes.length, 1);
  assert.equal(exp.data.appdocs.length, 1);
  resetLimits();
  const del = await call('/api/account', { method: 'DELETE', cookie: a.cookie, body: { confirm: 'DELETE', currentPassword: 'Violet-Harbor-Lamp-42' } });
  assert.equal(del.status, 200, JSON.stringify(del.data));
  assert.equal(db.notes.filter(x => x.ownerId === a.id).length, 0);
  assert.equal(db.appdocs.filter(x => x.ownerId === a.id).length, 0);
  assert.equal(db.calendars.filter(x => x.ownerId === a.id).length, 0);
});

test('app pages use no inline scripts or styles (the CSP forbids them)', () => {
  const files = [path.join(ROOT, 'satchel', 'public', 'index.html'), path.join(ROOT, 'satchel', 'public', 'home.html'),
    path.join(ROOT, 'satchel', 'public', 'account.html'),
    ...APPS.map(a => path.join(ROOT, a, 'index.html')), ...['margin', 'ledger', 'stride', 'tunnel'].map(a => path.join(ROOT, a, 'app.html'))];
  for (const f of files) {
    const html = fs.readFileSync(f, 'utf8');
    assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i, f + ' has an inline script');
    assert.doesNotMatch(html, /\sstyle="/i, f + ' has an inline style attribute');
    assert.doesNotMatch(html, /<style[\s>]/i, f + ' has a style block');
    assert.doesNotMatch(html, /\son[a-z]+="/i, f + ' has an inline event handler');
  }
});

test('the foods bank is well formed', () => {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'stride', 'data', 'foods.json'), 'utf8'));
  assert.ok(data.foods.length >= 200);
  const names = new Set();
  for (const f of data.foods) {
    assert.equal(f.length, 8, f[0]);
    assert.ok(!names.has(f[0]), 'duplicate ' + f[0]); names.add(f[0]);
    for (const v of f.slice(2, 7)) assert.ok(typeof v === 'number' && v >= 0 && v <= 900, f[0]);
    assert.match(f[7], /^[^:;]+:[\d.]+(;[^:;]+:[\d.]+)*$/, f[0]);
  }
});

test('Satchel settings: one time zone and photo on the account, shared by every app', async () => {
  const a = await account();
  let r = await call('/api/account', { method: 'PATCH', cookie: a.cookie, body: { timeZone: 'Europe/London' } });
  assert.equal(r.status, 200);
  assert.equal(r.data.account.timeZone, 'Europe/London');
  r = await call('/api/auth/me', { cookie: a.cookie });
  assert.equal(r.data.user.timeZone, 'Europe/London');
  for (const bad of ['Mars/Olympus', '', 'x'.repeat(80), 42, '../etc']) {
    r = await call('/api/account', { method: 'PATCH', cookie: a.cookie, body: { timeZone: bad } });
    assert.equal(r.status, 400, String(bad));
  }
  // Almanac follows the account zone.
  r = await call('/api/almanac/rpc', { method: 'POST', cookie: a.cookie, body: { command: 'snapshot', payload: {} } });
  assert.equal(r.status, 200);
  assert.equal(r.data.result.displayZone, 'Europe/London');
  // Photos: small image data URLs only; null removes it.
  const photo = 'data:image/jpeg;base64,' + Buffer.from('fake jpeg bytes').toString('base64');
  r = await call('/api/account', { method: 'PATCH', cookie: a.cookie, body: { avatar: photo } });
  assert.equal(r.status, 200);
  assert.equal(r.data.account.avatar, photo);
  r = await call('/api/almanac/rpc', { method: 'POST', cookie: a.cookie, body: { command: 'snapshot', payload: {} } });
  assert.equal(r.data.result.profile.avatar, photo);
  for (const bad of ['javascript:alert(1)', 'data:text/html;base64,PGI+', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/jpeg;base64,' + 'A'.repeat(210 * 1024)]) {
    r = await call('/api/account', { method: 'PATCH', cookie: a.cookie, body: { avatar: bad } });
    assert.notEqual(r.status, 200, bad.slice(0, 30));
  }
  r = await call('/api/account', { method: 'PATCH', cookie: a.cookie, body: { avatar: null } });
  assert.equal(r.data.account.avatar, null);
  // Almanac no longer changes the name or photo itself.
  r = await call('/api/almanac/rpc', { method: 'POST', cookie: a.cookie, body: { command: 'profile.save', payload: { name: 'Other' } } });
  assert.equal(r.status, 400);
});

test('Stride plan endpoint returns only the plan and skips unchanged data', async () => {
  const a = await account();
  let r = await call('/api/apps/stride/plan', { cookie: a.cookie });
  assert.deepEqual(r.data, { exists: false, plan: null, revision: 0 });
  const doc = { version: 2, profile: { weightKg: 70 }, log: { '2026-11-25': { entries: [] } }, plan: { meals: [{ id: 'm1', date: '2026-11-25', time: '08:00', name: 'Breakfast', items: [] }], workouts: [] } };
  r = await call('/api/apps/stride', { method: 'PUT', cookie: a.cookie, body: { document: doc, baseRevision: 0 } });
  assert.equal(r.status, 200);
  r = await call('/api/apps/stride/plan', { cookie: a.cookie });
  assert.equal(r.data.exists, true);
  assert.equal(r.data.plan.meals[0].id, 'm1');
  assert.equal(r.data.profile, undefined);
  assert.equal(JSON.stringify(r.data).includes('weightKg'), false);
  r = await call('/api/apps/stride/plan?since=' + r.data.revision, { cookie: a.cookie });
  assert.equal(r.data.unchanged, true);
  const other = await account();
  r = await call('/api/apps/stride/plan', { cookie: other.cookie });
  assert.equal(r.data.exists, false);
  r = await call('/api/apps/stride/plan');
  assert.equal(r.status, 401);
});
