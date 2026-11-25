// One private JSON document per person per app (Ledger accounts and transactions,
// Stride workouts and meals, Tunnel profiles, Margin's folder tree). Saves carry the
// revision they were based on, so a stale tab can never overwrite newer changes.
const express = require('express');
const crypto = require('crypto');
const { db, save } = require('./store');
const { revision, checkRevision } = require('./concurrency');
// App documents hold plain data: finite numbers (money in cents, timestamps), strings,
// booleans, arrays and objects, with a bounded depth and no prototype keys.
function safeData(value, depth = 0) {
  if (depth > 20) return false;
  if (typeof value === 'number') return Number.isFinite(value) && Math.abs(value) <= 1e15;
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return true;
  if (Array.isArray(value)) return value.length <= 100000 && value.every(v => safeData(v, depth + 1));
  if (typeof value !== 'object') return false;
  return Object.keys(value).length <= 100000 && Object.entries(value).every(([k, v]) => !['__proto__', 'constructor', 'prototype'].includes(k) && safeData(v, depth + 1));
}
const { withinQuota } = require('./quota');

const LIMITS = {
  ledger: 5 * 1024 * 1024,
  stride: 5 * 1024 * 1024,
  tunnel: 512 * 1024,
  margin: 512 * 1024,
};

const router = express.Router();

function appName(req, res) {
  const app = String(req.params.app || '');
  if (!Object.hasOwn(LIMITS, app)) { res.status(404).json({ error: 'Unknown app.' }); return null; }
  return app;
}
function find(userId, app) { return db.appdocs.find(d => d.ownerId === userId && d.app === app) || null; }

router.get('/:app', (req, res) => {
  const app = appName(req, res); if (!app) return;
  const doc = find(req.user.id, app);
  if (!doc) return res.json({ document: null, revision: 0, updatedAt: null });
  res.json({ document: doc.document, revision: revision(doc), updatedAt: doc.updatedAt });
});

router.put('/:app', (req, res) => {
  const app = appName(req, res); if (!app) return;
  const body = req.body || {};
  const document = body.document;
  if (!document || typeof document !== 'object' || Array.isArray(document) || !safeData(document)) return res.status(400).json({ error: 'This document is not valid.' });
  let bytes;
  try { bytes = Buffer.byteLength(JSON.stringify(document)); } catch { return res.status(400).json({ error: 'This document is not valid.' }); }
  if (bytes > LIMITS[app]) return res.status(413).json({ error: 'This is more data than the app can store. Remove some older entries first.' });
  let doc = find(req.user.id, app);
  const now = Date.now();
  if (!doc) {
    if ((body.baseRevision ?? 0) !== 0) return res.status(409).json({ error: 'This document was changed elsewhere since it was loaded. Reload, then reapply your change.', code: 'conflict', revision: 0 });
    doc = { id: crypto.randomUUID(), ownerId: req.user.id, app, createdAt: now, updatedAt: now, revision: 0, document: {}, docBytes: 2 };
    if (!withinQuota(req.user.id, doc, bytes)) return res.status(413).json({ error: 'Your Satchel storage is full.' });
    db.appdocs.push(doc);
  } else {
    if (!checkRevision(req, res, doc)) return;
    if (!withinQuota(req.user.id, doc, bytes)) return res.status(413).json({ error: 'Your Satchel storage is full.' });
  }
  doc.document = document;
  doc.docBytes = bytes;
  doc.updatedAt = now;
  doc.revision = revision(doc) + 1;
  save();
  res.json({ ok: true, revision: doc.revision, updatedAt: doc.updatedAt });
});

module.exports = router;
module.exports.find = find;
