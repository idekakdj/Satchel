// Satchel dashboard: a small read-only summary from every app, in one request.
const express = require('express');
const { db } = require('./store');
const almanac = require('./almanac');
const notes = require('./notes');
const { find } = require('./appdocs');

const router = express.Router();
const arr = v => (Array.isArray(v) ? v : []);
const int = v => (Number.isSafeInteger(v) ? v : 0);

function today(offsetMinutes) {
  const d = new Date(Date.now() - (Number.isFinite(offsetMinutes) ? offsetMinutes : 0) * 60000);
  return d.toISOString().slice(0, 10);
}

function ledger(doc) {
  if (!doc) return { empty: true };
  const d = doc.document, month = new Date().toISOString().slice(0, 7);
  let spent = 0, income = 0;
  const balances = new Map(arr(d.accounts).filter(a => !a.archived).map(a => [a.id, int(a.opening)]));
  for (const t of arr(d.transactions)) {
    const amt = int(t.amount);
    if (t.kind === 'expense') { if (balances.has(t.accountId)) balances.set(t.accountId, balances.get(t.accountId) - amt); if (String(t.date).startsWith(month)) spent += amt; }
    else if (t.kind === 'income') { if (balances.has(t.accountId)) balances.set(t.accountId, balances.get(t.accountId) + amt); if (String(t.date).startsWith(month)) income += amt; }
    else if (t.kind === 'transfer') {
      if (balances.has(t.accountId)) balances.set(t.accountId, balances.get(t.accountId) - amt);
      if (balances.has(t.toAccountId)) balances.set(t.toAccountId, balances.get(t.toAccountId) + amt);
    }
  }
  const budget = arr(d.categories).filter(c => c.kind === 'expense').reduce((s, c) => s + int(c.budget), 0);
  return { currency: typeof d.currency === 'string' ? d.currency : 'CAD', spent, income, budget, balance: [...balances.values()].reduce((a, b) => a + b, 0), count: arr(d.transactions).length };
}

function stride(doc, day) {
  if (!doc) return { empty: true };
  const d = doc.document, log = d.log && typeof d.log === 'object' ? d.log[day] : null;
  const eaten = arr(log && log.entries).reduce((s, e) => s + (Number(e.kcal) || 0), 0);
  const sessions = arr(d.sessions).slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const last = sessions[0];
  const week = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
  return {
    kcal: Math.round(eaten), goal: Math.round(Number(d.goals && d.goals.kcal) || 0),
    lastWorkout: last ? { name: String(last.name || 'Workout').slice(0, 80), date: String(last.date || '') } : null,
    workoutsThisWeek: sessions.filter(s => String(s.date) >= week).length,
  };
}

router.get('/', (req, res) => {
  const id = req.user.id, day = today(Number(req.query.tz));
  const myNotes = db.notes.filter(n => n.ownerId === id).sort((a, b) => b.updatedAt - a.updatedAt);
  const tunnel = find(id, 'tunnel');
  res.json({
    almanac: { upcoming: almanac.upcoming(id, req.user, 5) },
    margin: { count: myNotes.length, recent: myNotes.slice(0, 6).map(notes.summary) },
    ledger: ledger(find(id, 'ledger')),
    stride: stride(find(id, 'stride'), day),
    tunnel: { profiles: tunnel ? arr(tunnel.document.profiles).map(p => ({ id: String(p.id || ''), name: String(p.name || 'Profile').slice(0, 80), location: String(p.location || '').slice(0, 80) })) : [] },
  });
});

module.exports = router;
