// WireGuard helpers for Tunnel: X25519 keys, config text (wg-quick format), parsing and checks.
// Keys are made in the browser (Web Crypto, with a pure-JS fallback) and never sent anywhere
// except your own encrypted Satchel account.

const P = (1n << 255n) - 19n;
const A24 = 121665n;
const mod = a => { const r = a % P; return r < 0n ? r + P : r; };
function powMod(b, e) { let r = 1n; b = mod(b); while (e > 0n) { if (e & 1n) r = mod(r * b); b = mod(b * b); e >>= 1n; } return r; }
const toBig = bytes => { let n = 0n; for (let i = bytes.length - 1; i >= 0; i--) n = (n << 8n) | BigInt(bytes[i]); return n; };
const fromBig = n => { const out = new Uint8Array(32); for (let i = 0; i < 32; i++) { out[i] = Number(n & 255n); n >>= 8n; } return out; };

export function clamp(key) { const k = Uint8Array.from(key); k[0] &= 248; k[31] &= 127; k[31] |= 64; return k; }

/** RFC 7748 X25519 scalar multiplication (Montgomery ladder). */
export function x25519(scalar, u) {
  const k = toBig(clamp(scalar));
  const x1 = toBig(u) & ((1n << 255n) - 1n);
  let x2 = 1n, z2 = 0n, x3 = x1, z3 = 1n, swap = 0n;
  for (let t = 254n; t >= 0n; t--) {
    const kt = (k >> t) & 1n;
    swap ^= kt;
    if (swap) { [x2, x3] = [x3, x2]; [z2, z3] = [z3, z2]; }
    swap = kt;
    const A = mod(x2 + z2), AA = mod(A * A), B = mod(x2 - z2), BB = mod(B * B), E = mod(AA - BB);
    const C = mod(x3 + z3), D = mod(x3 - z3), DA = mod(D * A), CB = mod(C * B);
    x3 = mod((DA + CB) ** 2n);
    z3 = mod(x1 * mod((DA - CB) ** 2n));
    x2 = mod(AA * BB);
    z2 = mod(E * mod(AA + A24 * E));
  }
  if (swap) { [x2, x3] = [x3, x2]; [z2, z3] = [z3, z2]; }
  return fromBig(mod(x2 * powMod(z2, P - 2n)));
}
const BASE = (() => { const b = new Uint8Array(32); b[0] = 9; return b; })();

export const b64 = bytes => btoa(String.fromCharCode(...bytes));
export function unb64(s) { const bin = atob(String(s).trim()); return Uint8Array.from(bin, c => c.charCodeAt(0)); }
export function validKey(s) { try { return /^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw480]=$/.test(String(s).trim()) && unb64(s).length === 32; } catch { return false; } }

export function publicFromPrivate(privB64) { return b64(x25519(unb64(privB64), BASE)); }

/** A new key pair: { privateKey, publicKey } in WireGuard's base64. */
export async function generateKeyPair() {
  const priv = clamp(crypto.getRandomValues(new Uint8Array(32)));
  let pub = null;
  try {
    // Web Crypto X25519 (Chrome 133+, Safari 17+, Firefox 130+): import our clamped scalar and read back its public key.
    const pkcs8 = new Uint8Array([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x04, 0x22, 0x04, 0x20, ...priv]);
    const key = await crypto.subtle.importKey('pkcs8', pkcs8, { name: 'X25519' }, true, ['deriveBits']);
    const jwk = await crypto.subtle.exportKey('jwk', key);
    pub = Uint8Array.from(atob(jwk.x.replace(/-/g, '+').replace(/_/g, '/') + '='), c => c.charCodeAt(0));
  } catch { pub = null; }
  if (!pub || pub.length !== 32) pub = x25519(priv, BASE);
  return { privateKey: b64(priv), publicKey: b64(pub) };
}
export function generatePresharedKey() { return b64(crypto.getRandomValues(new Uint8Array(32))); }

// ---------- addresses ----------
export function validCidr(s) {
  const v = String(s).trim();
  const m4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/.exec(v);
  if (m4) return m4.slice(1, 5).every(n => +n <= 255) && +m4[5] <= 32;
  const m6 = /^([0-9a-fA-F:]+)\/(\d{1,3})$/.exec(v);
  return !!m6 && m6[1].includes(':') && +m6[2] <= 128 && m6[1].split('::').length <= 2;
}
export function validIp(s) { return validCidr(String(s).trim() + (String(s).includes(':') ? '/128' : '/32')); }
export function validEndpoint(s) {
  const v = String(s).trim();
  const m = /^(\[[0-9a-fA-F:]+\]|[A-Za-z0-9.-]+):(\d{1,5})$/.exec(v);
  return !!m && +m[2] >= 1 && +m[2] <= 65535 && (m[1].startsWith('[') || /^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*$/.test(m[1]));
}
const list = s => String(s || '').split(',').map(x => x.trim()).filter(Boolean);

// ---------- config text ----------
export function buildConfig(p) {
  const lines = ['[Interface]', `PrivateKey = ${p.privateKey}`, `Address = ${list(p.address).join(', ')}`];
  if (list(p.dns).length) lines.push(`DNS = ${list(p.dns).join(', ')}`);
  if (p.mtu) lines.push(`MTU = ${p.mtu}`);
  if (p.listenPort) lines.push(`ListenPort = ${p.listenPort}`);
  lines.push('', '[Peer]', `PublicKey = ${p.peer.publicKey}`);
  if (p.peer.presharedKey) lines.push(`PresharedKey = ${p.peer.presharedKey}`);
  lines.push(`AllowedIPs = ${list(p.peer.allowedIPs).join(', ')}`);
  if (p.peer.endpoint) lines.push(`Endpoint = ${p.peer.endpoint}`);
  if (p.peer.keepalive) lines.push(`PersistentKeepalive = ${p.peer.keepalive}`);
  return lines.join('\n') + '\n';
}

/** Parses wg-quick text. Only the first [Peer] is used (a client profile has one server). */
export function parseConfig(text) {
  const out = { privateKey: '', address: '', dns: '', mtu: null, listenPort: null, peer: { publicKey: '', presharedKey: '', allowedIPs: '', endpoint: '', keepalive: null }, extraPeers: 0, unknown: [] };
  let section = null, peers = 0;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/[#;].*$/, '').trim();
    if (!line) continue;
    const sec = /^\[(\w+)\]$/.exec(line);
    if (sec) { section = sec[1].toLowerCase(); if (section === 'peer') peers++; continue; }
    const kv = /^([A-Za-z]+)\s*=\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1].toLowerCase(), val = kv[2].trim();
    if (section === 'interface') {
      if (key === 'privatekey') out.privateKey = val;
      else if (key === 'address') out.address = out.address ? out.address + ', ' + val : val;
      else if (key === 'dns') out.dns = out.dns ? out.dns + ', ' + val : val;
      else if (key === 'mtu') out.mtu = Number(val) || null;
      else if (key === 'listenport') out.listenPort = Number(val) || null;
      else out.unknown.push(kv[1]);
    } else if (section === 'peer' && peers === 1) {
      if (key === 'publickey') out.peer.publicKey = val;
      else if (key === 'presharedkey') out.peer.presharedKey = val;
      else if (key === 'allowedips') out.peer.allowedIPs = out.peer.allowedIPs ? out.peer.allowedIPs + ', ' + val : val;
      else if (key === 'endpoint') out.peer.endpoint = val;
      else if (key === 'persistentkeepalive') out.peer.keepalive = Number(val) || null;
      else out.unknown.push(kv[1]);
    }
  }
  out.extraPeers = Math.max(0, peers - 1);
  return out;
}

/** Problems and advice for a profile: [{ level: 'error'|'warn'|'ok', text }]. */
export function check(p) {
  const r = [];
  const err = t => r.push({ level: 'error', text: t }), warn = t => r.push({ level: 'warn', text: t }), ok = t => r.push({ level: 'ok', text: t });
  if (!validKey(p.privateKey)) err('The private key is missing or not a valid WireGuard key.');
  if (!validKey(p.peer.publicKey)) err('The server’s public key is missing or not a valid WireGuard key.');
  if (p.peer.presharedKey && !validKey(p.peer.presharedKey)) err('The preshared key is not a valid WireGuard key.');
  if (validKey(p.privateKey) && validKey(p.peer.publicKey) && publicFromPrivate(p.privateKey) === p.peer.publicKey) err('The server’s public key is this device’s own key. Use the key from the server instead.');
  const addrs = list(p.address);
  if (!addrs.length) err('Add the tunnel address the server gave this device (for example 10.8.0.2/32).');
  else if (!addrs.every(validCidr)) err('An address is not in the form 10.8.0.2/32 or fd00::2/128.');
  if (!p.peer.endpoint) err('Add the server address and port (for example vpn.example.com:51820).');
  else if (!validEndpoint(p.peer.endpoint)) err('The endpoint must look like host:port, for example 203.0.113.5:51820 or [2001:db8::1]:51820.');
  const allowed = list(p.peer.allowedIPs);
  if (!allowed.length) err('Add AllowedIPs. Use 0.0.0.0/0, ::/0 to send all traffic through the VPN.');
  else if (!allowed.every(validCidr)) err('An AllowedIPs entry is not a valid network (for example 0.0.0.0/0).');
  const full4 = allowed.includes('0.0.0.0/0'), full6 = allowed.includes('::/0');
  if (full4) ok('All IPv4 traffic goes through the tunnel, which hides it from the local Wi-Fi and changes your apparent location.');
  else if (allowed.length) warn('Only some traffic goes through the tunnel (split tunnel). For public Wi-Fi privacy or a new location, use 0.0.0.0/0, ::/0.');
  if (full4 && !full6) warn('IPv6 traffic is not covered. Add ::/0 to AllowedIPs (the server can drop it if it has no IPv6) so IPv6 cannot leak around the tunnel.');
  const dns = list(p.dns);
  if (full4 && !dns.length) warn('No DNS server is set, so name lookups may still go to the local network (a DNS leak). Add one, such as 1.1.1.1 or your provider’s DNS.');
  else if (dns.length && !dns.every(d => validIp(d) || /^[A-Za-z0-9.-]+$/.test(d))) err('A DNS entry is not an IP address.');
  else if (dns.length) ok('DNS lookups use ' + dns.join(', ') + '.');
  if (!p.peer.keepalive) warn('PersistentKeepalive is off. Setting it to 25 keeps the tunnel alive behind café and campus routers.');
  if (p.mtu && (p.mtu < 1280 || p.mtu > 1500)) warn('MTU is usually between 1280 and 1420. Leave it blank unless pages fail to load.');
  if (!p.peer.presharedKey) r.push({ level: 'info', text: 'No preshared key. It is optional; adding one gives an extra layer of protection.' });
  return r;
}

/** Server side of a self-hosted setup (Linux, wg-quick), for the guide. */
export function serverConfig({ serverPrivateKey, serverAddress, listenPort, clients, nic }) {
  const lines = ['[Interface]', `Address = ${serverAddress}`, `ListenPort = ${listenPort}`, `PrivateKey = ${serverPrivateKey}`,
    `PostUp = iptables -A FORWARD -i %i -j ACCEPT; iptables -t nat -A POSTROUTING -o ${nic} -j MASQUERADE`,
    `PostDown = iptables -D FORWARD -i %i -j ACCEPT; iptables -t nat -D POSTROUTING -o ${nic} -j MASQUERADE`];
  for (const c of clients) {
    lines.push('', `# ${c.name}`, '[Peer]', `PublicKey = ${c.publicKey}`);
    if (c.presharedKey) lines.push(`PresharedKey = ${c.presharedKey}`);
    lines.push(`AllowedIPs = ${c.ip}`);
  }
  return lines.join('\n') + '\n';
}
