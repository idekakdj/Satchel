// Satchel dashboard: a small read-only summary from every app, in one request.
const express = require('express');
const { db } = require('./store');
const almanac = require('./almanac');
const notes = require('./notes');
const { find } = require('./appdocs');

const router = express.Router();
const arr = v => (Array.isArray(v) ? v : []);
const int = v => (Number.isSafeInteger(v) ? v : 0);

// Today's date and the clock time in the person's Satchel time zone (Settings), falling
// back to the browser's UTC offset sent as ?tz= for accounts without one.
function clock(user, offsetMinutes) {
  if (user && typeof user.timeZone === 'string') {
    try {
      const p = {};
      for (const x of new Intl.DateTimeFormat('en-CA', { timeZone: user.timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date())) p[x.type] = x.value;
      return { day: `${p.year}-${p.month}-${p.day}`, time: `${p.hour === '24' ? '00' : p.hour}:${p.minute}` };
    } catch { /* unknown zone: fall through */ }
  }
  const d = new Date(Date.now() - (Number.isFinite(offsetMinutes) ? offsetMinutes : 0) * 60000).toISOString();
  return { day: d.slice(0, 10), time: d.slice(11, 16) };
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

function stride(doc, day, nowTime) {
  if (!doc) return { empty: true };
  const d = doc.document, log = d.log && typeof d.log === 'object' ? d.log[day] : null;
  const eaten = arr(log && log.entries).reduce((s, e) => s + (Number(e.kcal) || 0), 0);
  const sessions = arr(d.sessions).slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const last = sessions[0];
  const week = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
  // Next planned meal or workout from today (this minute) onwards, skipping ones already logged or done.
  const plan = d.plan && typeof d.plan === 'object' ? d.plan : {};
  const cand = [];
  const add = (kind, p) => {
    if (!p || typeof p.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(p.date)) return;
    const time = typeof p.time === 'string' && /^\d{2}:\d{2}$/.test(p.time) ? p.time : '00:00';
    if (p.date < day || (p.date === day && time < nowTime)) return;
    cand.push({ kind, id: String(p.id || '').slice(0, 64), name: String(p.name || (kind === 'meal' ? 'Meal' : 'Workout')).slice(0, 80), date: p.date, time });
  };
  for (const m of arr(plan.meals)) if (!m || !m.loggedAt) add('meal', m);
  for (const w of arr(plan.workouts)) if (!w || !w.sessionId) add('workout', w);
  cand.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  return {
    kcal: Math.round(eaten), goal: Math.round(Number(d.goals && d.goals.kcal) || 0),
    lastWorkout: last ? { name: String(last.name || 'Workout').slice(0, 80), date: String(last.date || '') } : null,
    workoutsThisWeek: sessions.filter(s => String(s.date) >= week).length,
    next: cand[0] || null,
  };
}

router.get('/', (req, res) => {
  const id = req.user.id, now = clock(req.user, Number(req.query.tz)), day = now.day;
  const myNotes = db.notes.filter(n => n.ownerId === id).sort((a, b) => b.updatedAt - a.updatedAt);
  const tunnel = find(id, 'tunnel');
  res.json({
    almanac: { upcoming: almanac.upcoming(id, req.user, 5) },
    margin: { count: myNotes.length, recent: myNotes.slice(0, 6).map(notes.summary) },
    ledger: ledger(find(id, 'ledger')),
    stride: stride(find(id, 'stride'), day, now.time),
    tunnel: { profiles: tunnel ? arr(tunnel.document.profiles).map(p => ({ id: String(p.id || ''), name: String(p.name || 'Profile').slice(0, 80), location: String(p.location || '').slice(0, 80) })) : [] },
  });
});

module.exports = router;
