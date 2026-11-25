// Margin notes: typed text plus handwriting (vector ink strokes). Every route checks
// ownership; content saves carry a base revision so two devices can't silently
// overwrite each other.
const express = require('express');
const crypto = require('crypto');
const { db, save } = require('./store');
const { revision, checkRevision } = require('./concurrency');
const { safeTree, cleanName } = require('./validation');
const { withinQuota } = require('./quota');

const router = express.Router();
const MAX_NOTES = 2000;
const MAX_NOTE_BYTES = 8 * 1024 * 1024;
const MAX_TEXT = 500 * 1024;
const MAX_STROKES = 20000;
const PAPERS = ['blank', 'lined', 'grid', 'dotted'];
const ID = /^[A-Za-z0-9_-]{1,64}$/;

function summary(n) {
  return {
    id: n.id, folderId: n.folderId || null, title: n.title, pinned: !!n.pinned,
    preview: String(n.text || '').slice(0, 160), hasInk: !!(n.ink && n.ink.strokes && n.ink.strokes.length),
    createdAt: n.createdAt, updatedAt: n.updatedAt, revision: revision(n),
  };
}
function full(n) {
  return { ...summary(n), text: n.text || '', ink: n.ink || { strokes: [] }, paper: n.paper || 'lined', height: n.height || 1100 };
}
function findOwned(req, res) {
  const n = ID.test(req.params.id) ? db.notes.find(x => x.id === req.params.id) : null;
  if (!n || n.ownerId !== req.user.id) { res.status(404).json({ error: 'Note not found.' }); return null; }
  return n;
}
function validInk(ink) {
  if (!ink || typeof ink !== 'object' || !Array.isArray(ink.strokes) || ink.strokes.length > MAX_STROKES) return false;
  return ink.strokes.every(s => s && typeof s === 'object' && typeof s.id === 'string' && s.id.length <= 40 &&
    ['pen', 'pencil', 'highlighter'].includes(s.tool) && typeof s.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(s.color) &&
    typeof s.size === 'number' && s.size > 0 && s.size <= 60 && Array.isArray(s.pts) && s.pts.length % 3 === 0 && s.pts.length <= 30000 &&
    s.pts.every(v => Number.isInteger(v) && v >= -100000 && v <= 10000000) &&
    (s.tilt === undefined || (typeof s.tilt === 'number' && s.tilt >= 0 && s.tilt <= 1)));
}
function validFolderId(v) { return v === null || (typeof v === 'string' && ID.test(v)); }

router.get('/', (req, res) => {
  // ?q= searches titles and typed text (case-insensitive) across every folder.
  const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase().slice(0, 100) : '';
  const mine = db.notes
    .filter(n => n.ownerId === req.user.id)
    .filter(n => !q || String(n.title).toLowerCase().includes(q) || String(n.text || '').toLowerCase().includes(q))
    .map(n => {
      const s = summary(n);
      if (q) {
        const text = String(n.text || ''), at = text.toLowerCase().indexOf(q);
        if (at > 40) s.preview = '…' + text.slice(at - 30, at + 130);
      }
      return s;
    })
    .sort((a, b) => b.updatedAt - a.updatedAt);
  res.json({ notes: mine });
});

router.post('/', (req, res) => {
  const body = req.body || {};
  if (db.notes.filter(n => n.ownerId === req.user.id).length >= MAX_NOTES) return res.status(400).json({ error: `You can keep up to ${MAX_NOTES} notes.` });
  const title = body.title === undefined ? 'Untitled note' : cleanName(body.title, 200);
  if (!title) return res.status(400).json({ error: 'Give the note a title of up to 200 characters.' });
  const folderId = body.folderId === undefined ? null : body.folderId;
  if (!validFolderId(folderId)) return res.status(400).json({ error: 'Invalid folder.' });
  const paper = PAPERS.includes(body.paper) ? body.paper : 'lined';
  const now = Date.now();
  const n = { id: crypto.randomBytes(9).toString('base64url'), ownerId: req.user.id, folderId, title, text: '', ink: { strokes: [] }, paper, height: 1100, pinned: false, createdAt: now, updatedAt: now, revision: 0, docBytes: 64 };
  db.notes.push(n);
  save();
  res.status(201).json({ note: full(n) });
});

router.get('/:id', (req, res) => {
  const n = findOwned(req, res); if (!n) return;
  res.json({ note: full(n) });
});

// Any subset of fields. Content changes (text, ink, paper, height) need baseRevision.
router.put('/:id', (req, res) => {
  const n = findOwned(req, res); if (!n) return;
  const b = req.body || {};
  const content = ['text', 'ink', 'paper', 'height'].some(k => b[k] !== undefined);
  if (content && b.baseRevision === undefined) return res.status(400).json({ error: 'baseRevision is required when changing note content.' });
  if (!checkRevision(req, res, n)) return;
  const next = {};
  if (b.title !== undefined) { const t = cleanName(b.title, 200); if (!t) return res.status(400).json({ error: 'Give the note a title of up to 200 characters.' }); next.title = t; }
  if (b.folderId !== undefined) { if (!validFolderId(b.folderId)) return res.status(400).json({ error: 'Invalid folder.' }); next.folderId = b.folderId; }
  if (b.pinned !== undefined) next.pinned = !!b.pinned;
  if (b.text !== undefined) { if (typeof b.text !== 'string' || b.text.length > MAX_TEXT) return res.status(400).json({ error: 'Notes can hold up to 500,000 characters of text.' }); next.text = b.text; }
  if (b.paper !== undefined) { if (!PAPERS.includes(b.paper)) return res.status(400).json({ error: 'Unknown paper style.' }); next.paper = b.paper; }
  if (b.height !== undefined) { if (!Number.isInteger(b.height) || b.height < 400 || b.height > 40000) return res.status(400).json({ error: 'Invalid page height.' }); next.height = b.height; }
  if (b.ink !== undefined) { if (!validInk(b.ink) || !safeTree(b.ink)) return res.status(400).json({ error: 'The handwriting in this note could not be saved.' }); next.ink = { strokes: b.ink.strokes.map(s => ({ id: s.id, tool: s.tool, color: s.color, size: s.size, pts: s.pts, ...(s.tilt !== undefined ? { tilt: s.tilt } : {}) })) }; }
  const merged = { ...n, ...next };
  const bytes = Buffer.byteLength(JSON.stringify({ t: merged.title, x: merged.text, i: merged.ink }));
  if (bytes > MAX_NOTE_BYTES) return res.status(413).json({ error: 'This note is too large. Split it into two notes.' });
  if (!withinQuota(req.user.id, n, bytes)) return res.status(413).json({ error: 'Your Satchel storage is full.' });
  Object.assign(n, next, { docBytes: bytes, updatedAt: Date.now(), revision: revision(n) + 1 });
  save();
  res.json({ ok: true, revision: n.revision, updatedAt: n.updatedAt });
});

router.delete('/:id', (req, res) => {
  const n = findOwned(req, res); if (!n) return;
  db.notes.splice(db.notes.indexOf(n), 1);
  save();
  res.json({ ok: true });
});

module.exports = router;
module.exports.summary = summary;
