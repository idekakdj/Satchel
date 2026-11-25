// QR Code encoder for Tunnel (ISO/IEC 18004), ported from satchel/server/qr.js and extended:
// byte mode (UTF-8), error correction level L, versions 1 to 20 (up to 858 bytes), which is
// enough for a WireGuard configuration. Runs in the browser so keys never leave the device.
// encode(text) -> { size, rows } with rows of '1' (dark) / '0' (light), no quiet zone.

// Level L, per version: error-correction codewords per block, then [blocks, data codewords per block] groups.
const L_TABLE = [
  null,
  { ec: 7, groups: [[1, 19]] }, { ec: 10, groups: [[1, 34]] }, { ec: 15, groups: [[1, 55]] }, { ec: 20, groups: [[1, 80]] },
  { ec: 26, groups: [[1, 108]] }, { ec: 18, groups: [[2, 68]] }, { ec: 20, groups: [[2, 78]] }, { ec: 24, groups: [[2, 97]] },
  { ec: 30, groups: [[2, 116]] }, { ec: 18, groups: [[2, 68], [2, 69]] }, { ec: 20, groups: [[4, 81]] }, { ec: 24, groups: [[2, 92], [2, 93]] },
  { ec: 26, groups: [[4, 107]] }, { ec: 30, groups: [[3, 115], [1, 116]] }, { ec: 22, groups: [[5, 87], [1, 88]] }, { ec: 24, groups: [[5, 98], [1, 99]] },
  { ec: 28, groups: [[1, 107], [5, 108]] }, { ec: 30, groups: [[5, 120], [1, 121]] }, { ec: 28, groups: [[3, 113], [4, 114]] }, { ec: 28, groups: [[3, 107], [5, 108]] },
];
const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
  [6, 30, 54], [6, 32, 58], [6, 34, 62], [6, 26, 46, 66], [6, 26, 48, 70], [6, 26, 50, 74], [6, 30, 54, 78], [6, 30, 56, 82], [6, 30, 58, 86], [6, 34, 62, 90]];
const MAX_VERSION = 20;

const EXP = new Array(512), LOG = new Array(256);
for (let i = 0, x = 1; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11d; }
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
const gmul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

function generator(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) { next[j] ^= poly[j]; next[j + 1] ^= gmul(poly[j], EXP[i]); }
    poly = next;
  }
  return poly;
}
function rsRemainder(data, degree) {
  const gen = generator(degree), rem = new Array(degree).fill(0);
  for (const byte of data) {
    const factor = byte ^ rem.shift();
    rem.push(0);
    if (factor) for (let i = 0; i < degree; i++) rem[i] ^= gmul(gen[i + 1], factor);
  }
  return rem;
}
const dataCapacity = v => L_TABLE[v].groups.reduce((n, [count, len]) => n + count * len, 0);
function pickVersion(n) {
  for (let v = 1; v <= MAX_VERSION; v++) if (4 + (v <= 9 ? 8 : 16) + 8 * n <= dataCapacity(v) * 8) return v;
  throw new Error('This configuration is too long for a QR code. Download the file instead.');
}
function dataCodewords(bytes, version) {
  const bits = [];
  const push = (value, n) => { for (let i = n - 1; i >= 0; i--) bits.push((value >>> i) & 1); };
  push(0b0100, 4);
  push(bytes.length, version <= 9 ? 8 : 16);
  for (const b of bytes) push(b, 8);
  const cap = dataCapacity(version) * 8;
  push(0, Math.min(4, cap - bits.length));
  while (bits.length % 8) bits.push(0);
  const out = [];
  for (let i = 0; i < bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  for (let pad = 0xec; out.length < dataCapacity(version); pad ^= 0xec ^ 0x11) out.push(pad);
  return out;
}
function buildBlocks(text) {
  const bytes = new TextEncoder().encode(String(text));
  const version = pickVersion(bytes.length);
  const data = dataCodewords(bytes, version);
  const { ec, groups } = L_TABLE[version];
  const blocks = [];
  let at = 0;
  for (const [count, len] of groups) for (let i = 0; i < count; i++) { const chunk = data.slice(at, at + len); at += len; blocks.push({ data: chunk, ec: rsRemainder(chunk, ec) }); }
  const codewords = [];
  const longest = Math.max(...blocks.map(b => b.data.length));
  for (let i = 0; i < longest; i++) for (const b of blocks) if (i < b.data.length) codewords.push(b.data[i]);
  for (let i = 0; i < ec; i++) for (const b of blocks) codewords.push(b.ec[i]);
  return { version, codewords };
}
function formatBits(mask) {                         // level L is 01
  const data = (0b01 << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}
function versionBits(version) {
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (version << 12) | rem;
}
function drawFormat({ size, set }, mask) {
  const bits = formatBits(mask), bit = i => ((bits >>> i) & 1) === 1;
  for (let i = 0; i <= 5; i++) set(8, i, bit(i));
  set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
  for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
  set(8, size - 8, true);
}
function baseMatrix(version) {
  const size = 17 + 4 * version;
  const modules = Array.from({ length: size }, () => new Array(size).fill(false));
  const fn = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y, dark) => { modules[y][x] = dark; fn[y][x] = true; };
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  const finder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      set(x, y, d !== 2 && d !== 4);
    }
  };
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
  const pos = ALIGN[version];
  for (let i = 0; i < pos.length; i++) for (let j = 0; j < pos.length; j++) {
    if ((i === 0 && j === 0) || (i === 0 && j === pos.length - 1) || (i === pos.length - 1 && j === 0)) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(pos[i] + dx, pos[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  const m = { modules, fn, size, set };
  drawFormat(m, 0);
  if (version >= 7) {
    const bits = versionBits(version);
    for (let i = 0; i < 18; i++) { const dark = ((bits >>> i) & 1) === 1; const a = size - 11 + (i % 3), b = Math.floor(i / 3); set(a, b, dark); set(b, a, dark); }
  }
  return m;
}
function placeData(m, codewords) {
  const { modules, fn, size } = m;
  let i = 0;
  const total = codewords.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
      const x = right - j, y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
      if (!fn[y][x] && i < total) { modules[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) === 1; i++; }
    }
  }
}
const MASKS = [
  (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x, y) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];
function masked(m, mask) {
  const { modules, fn, size } = m;
  const out = modules.map(r => r.slice());
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && MASKS[mask](x, y)) out[y][x] = !out[y][x];
  drawFormat({ size, set: (x, y, dark) => { out[y][x] = dark; } }, mask);
  return out;
}
function penalty(g) {
  const size = g.length;
  let score = 0;
  const lines = [];
  for (let i = 0; i < size; i++) lines.push(g[i], g.map(r => r[i]));
  for (const line of lines) {
    let run = 1;
    for (let i = 1; i <= size; i++) { if (i < size && line[i] === line[i - 1]) run++; else { if (run >= 5) score += 3 + (run - 5); run = 1; } }
    const s = line.map(v => (v ? 1 : 0)).join('');
    for (const pat of ['10111010000', '00001011101']) for (let i = s.indexOf(pat); i !== -1; i = s.indexOf(pat, i + 1)) score += 40;
  }
  for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) if (g[y][x] === g[y][x + 1] && g[y][x] === g[y + 1][x] && g[y][x] === g[y + 1][x + 1]) score += 3;
  const dark = g.reduce((n, r) => n + r.filter(Boolean).length, 0), pct = (dark * 100) / (size * size);
  score += Math.min(Math.abs(Math.floor(pct / 5) * 5 - 50), Math.abs(Math.ceil(pct / 5) * 5 - 50)) / 5 * 10;
  return score;
}
export function encode(text) {
  const { version, codewords } = buildBlocks(text);
  const m = baseMatrix(version);
  placeData(m, codewords);
  let best = null, bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) { const g = masked(m, mask); const s = penalty(g); if (s < bestScore) { best = g; bestScore = s; } }
  return { size: m.size, version, rows: best.map(r => r.map(v => (v ? '1' : '0')).join('')) };
}
export function drawQr(canvas, { size, rows }, { scale = 5, margin = 4 } = {}) {
  const px = (size + 2 * margin) * scale;
  canvas.width = px; canvas.height = px;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, px, px);
  ctx.fillStyle = '#000000';
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (rows[y][x] === '1') ctx.fillRect((x + margin) * scale, (y + margin) * scale, scale, scale);
}
