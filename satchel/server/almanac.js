// Almanac (calendar) route: one RPC endpoint in front of the calendar service that
// is bundled from almanac/src/server (npm run build in almanac/). Each account's
// calendar lives in db.calendars as { id, ownerId, state }.
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const { db, save } = require('./store');
const { requireAuth } = require('./security');

const ASSET_ROOT = process.env.SATCHEL_ASSET_ROOT || path.join(__dirname, '..', '..');
const BUNDLE = path.join(ASSET_ROOT, 'almanac', 'server', 'almanac-service.cjs');

let service = null;
function load() {
  if (service) return service;
  if (!fs.existsSync(BUNDLE)) return null;
  service = require(BUNDLE);
  return service;
}

const host = {
  load(userId) { const rec = db.calendars.find(c => c.ownerId === userId); return rec ? rec.state : undefined; },
  save(userId, state) {
    const now = Date.now();
    db.calendars.push({ id: crypto.randomUUID(), ownerId: userId, createdAt: now, updatedAt: now, state });
    save();
  },
  persist() { save(); },
};

function satchelUser(u) {
  return { id: u.id, email: u.email, name: u.name || String(u.email || '').split('@')[0], createdAt: u.createdAt ? new Date(u.createdAt).toISOString() : undefined };
}

const router = express.Router();
router.use(requireAuth);

router.post('/rpc', (req, res) => {
  const svc = load();
  if (!svc) return res.status(503).json({ ok: false, error: 'Almanac is not built yet. Run npm run build in the almanac folder.' });
  const { command, payload } = req.body || {};
  try {
    const result = svc.run(satchelUser(req.user), host, command, payload);
    const rec = db.calendars.find(c => c.ownerId === req.user.id);
    if (rec) rec.updatedAt = Date.now();
    res.json({ ok: true, result: result === undefined ? null : result });
  } catch (err) {
    // Validation errors from zod carry a list of issues; show the first one plainly.
    let message = err && err.message ? String(err.message) : 'Something went wrong.';
    if (err && Array.isArray(err.issues) && err.issues[0]) message = err.issues[0].message || 'Check the highlighted details and try again.';
    else if (message.startsWith('[')) message = 'Check the details and try again.';
    res.status(400).json({ ok: false, error: message.slice(0, 500) });
  }
});

// Small summary for the Satchel dashboard: the next few things on the calendar.
function upcoming(userId, user, limit = 5) {
  const svc = load();
  if (!svc || !svc.upcomingSummary) return [];
  const state = host.load(userId);
  if (!state) return [];
  try { return svc.upcomingSummary(satchelUser(user), host, limit); } catch { return []; }
}

function release(userId) { const svc = load(); if (svc) svc.release(userId); }

module.exports = { router, upcoming, release };
