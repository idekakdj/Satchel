// Autosave store (satchel/public/js/app-kit.js): an edit made while a save is in flight must
// never be marked as saved by that save's reply. Runs the real module with a fake fetch/DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const listeners = {};
globalThis.window = { addEventListener: (t, f) => { (listeners[t] ||= []).push(f); }, dispatchEvent() {} };
globalThis.document = { addEventListener() {}, visibilityState: 'visible', createElement: () => ({ style: {}, append() {}, setAttribute() {} }) };
const puts = [];
let releasePut = null;
globalThis.fetch = async (url, init = {}) => {
  const json = body => ({ ok: true, status: 200, json: async () => body });
  if (url === '/api/auth/me') return json({ user: { id: 'u1', timeZone: 'Europe/London' } });
  if (init.method === 'PUT') {
    const body = JSON.parse(init.body);
    puts.push(body.document.value);
    // Hold the first save until the test lets it finish.
    if (puts.length === 1) await new Promise(r => { releasePut = r; });
    return json({ ok: true, revision: body.baseRevision + 1 });
  }
  return json({ document: { value: 0 }, revision: 1 });
};

// satchel/ is a CommonJS package, so load the browser module from a temporary .mjs copy.
const source = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'js', 'app-kit.js');
const copy = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'satchel-kit-')), 'app-kit.mjs');
fs.copyFileSync(source, copy);
const kit = await import(pathToFileURL(copy).href);
const wait = ms => new Promise(r => setTimeout(r, ms));

test('the app kit reads the account time zone and validates dates', () => {
  assert.equal(kit.zone(), 'Europe/London');
  assert.match(kit.todayISO(), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(kit.isISODate('2026-02-28'), true);
  for (const bad of ['2026-13-01', '2026-02-30', '26-01-01', '', null]) assert.equal(kit.isISODate(bad), false, String(bad));
  assert.equal(kit.addDaysISO('2026-12-31', 1), '2027-01-01');
});

test('an edit during an in-flight save is saved afterwards, not lost', async () => {
  const states = [];
  const store = kit.createDocStore('stride', { defaults: () => ({ value: 0 }), onState: s => states.push(s) });
  await store.load();
  store.doc.value = 1; store.changed();
  await wait(800);                     // debounce fires: PUT #1 (value 1) is now in flight
  assert.deepEqual(puts, [1]);
  store.doc.value = 2; store.changed(); // a second edit while #1 is still in flight
  assert.equal(store.dirty, true);
  releasePut();                         // #1 finishes before the second edit's debounce
  await wait(50);
  // #1's reply did not mark edit 2 as saved: the store sent edit 2 straight away.
  assert.deepEqual(puts, [1, 2], 'the second edit reaches the server');
  assert.equal(store.state, 'saved');
  assert.equal(store.dirty, false);
  await wait(900);                      // the second edit's debounce finds nothing left to send
  assert.deepEqual(puts, [1, 2]);
});
