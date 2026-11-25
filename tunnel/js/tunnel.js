// Tunnel: WireGuard profile manager. Stores profiles (with their private keys) in the encrypted
// Satchel account, shows them as QR codes and .conf files for the official WireGuard apps, and
// guides a self-hosted server setup. It does not route any traffic itself.
import { h, icon, toast, sheet, confirmSheet, uid, download, pickFile, createDocStore, saveLabel, onShellNavigate } from '/js/app-kit.js';
import { generateKeyPair, generatePresharedKey, buildConfig, parseConfig, check, serverConfig, validKey, publicFromPrivate, validEndpoint } from './wg.js';
import { encode, drawQr } from './qr.js';

const $ = id => document.getElementById(id);
const DEVICES = ['iPhone', 'iPad', 'Android phone', 'Laptop', 'Windows PC', 'Mac', 'Linux', 'Other'];
const DNS_CHOICES = [['1.1.1.1, 1.0.0.1', 'Cloudflare (1.1.1.1)'], ['9.9.9.9, 149.112.112.112', 'Quad9 (blocks known malware sites)'], ['8.8.8.8, 8.8.4.4', 'Google (8.8.8.8)'], ['10.8.0.1', 'My server (if it runs a DNS resolver)']];

const store = createDocStore('tunnel', {
  defaults: () => ({ version: 1, profiles: [], server: null }),
  migrate: d => ({ version: 1, profiles: [], server: null, ...d }),
  onState: s => saveLabel($('save-state'), s),
  onConflict: () => toast('Tunnel changed on another device.', { error: true, action: () => location.reload(), actionLabel: 'Reload' }),
});
const D = () => store.doc;
const state = { tab: 'profiles' };
function changed() { store.changed(); render(); }
const safeFile = s => (String(s).replace(/[^A-Za-z0-9_=+.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 15) || 'wg0') + '.conf';
function worst(results) { return results.some(r => r.level === 'error') ? 'error' : results.some(r => r.level === 'warn') ? 'warn' : 'ok'; }

// ---------- frame ----------
const TABS = [['profiles', 'Profiles'], ['server', 'My server'], ['help', 'How to connect']];
function render() {
  const nav = $('tabs'); nav.textContent = '';
  for (const [k, l] of TABS) nav.append(h('button', { type: 'button', role: 'tab', 'aria-selected': String(state.tab === k), text: l, onclick: () => { state.tab = k; render(); } }));
  const v = $('view'); v.textContent = '';
  ({ profiles, server, help })[state.tab](v);
}

// ---------- profiles ----------
function profiles(v) {
  v.append(h('div.page-head', h('div', h('h1', { text: 'VPN profiles' }), h('p', { text: 'One profile per device and server location. Import them into the WireGuard app to connect.' }))));
  v.append(h('div.notice', icon('shield', 20), h('p', { text: 'A browser cannot switch on a system VPN, so Tunnel prepares and checks your WireGuard profiles and the free WireGuard app makes the actual connection. Private keys are created on this device and stored only in your encrypted Satchel account.' })));
  if (!D().profiles.length) {
    v.append(h('div.card', h('div.empty-state', h('h3', { text: 'No profiles yet' }), h('p', { text: 'Paste a WireGuard config from a VPN provider (Mullvad, Proton VPN, IVPN and others offer them), or set up your own server on a VPS in the country you want to appear from.' }), h('button.btn.btn-accent', { type: 'button', text: 'Add your first profile', onclick: newProfile }))));
    return;
  }
  const cards = h('div.cards');
  for (const p of D().profiles) {
    const res = check(p), w = worst(res);
    cards.append(h('section.card.profile-card',
      h('div.card-head', h('h2', { text: p.name }), h('span.status.' + w, { text: w === 'error' ? 'Needs fixing' : w === 'warn' ? 'Works, with advice' : 'Ready' })),
      h('div.where', { text: [p.location, p.device].filter(Boolean).join(' · ') || 'WireGuard' }),
      h('div.endpoint', { text: p.peer.endpoint || 'No endpoint', title: p.peer.endpoint }),
      h('div.row', { style: { marginTop: '12px' } },
        h('button.btn.btn-sm.btn-accent', { type: 'button', onclick: () => detail(p, 'qr') }, icon('qr', 15), 'QR code'),
        h('button.btn.btn-sm', { type: 'button', onclick: () => saveConf(p) }, icon('download', 15), '.conf'),
        h('button.btn.btn-sm.btn-ghost', { type: 'button', onclick: () => detail(p, 'details') }, 'Details'))));
  }
  v.append(cards);
}
function saveConf(p) {
  const res = check(p);
  if (worst(res) === 'error') { toast('Fix this profile before exporting: ' + res.find(r => r.level === 'error').text, { error: true }); return; }
  download(safeFile(p.name), buildConfig(p), 'text/plain');
  toast('Downloaded. Import it in WireGuard with “Import tunnel(s) from file”.');
}

function detail(p, focus) {
  const s = sheet(p.name, { wide: true });
  const res = check(p), bad = worst(res) === 'error';
  const conf = buildConfig(p);
  if (focus === 'qr' && !bad) {
    const canvas = h('canvas', { 'aria-label': 'QR code for ' + p.name, role: 'img' });
    try { drawQr(canvas, encode(conf), { scale: 5 }); s.body.append(h('div.qr-wrap', canvas), h('p.hint', { style: { textAlign: 'center' }, text: 'In the WireGuard app on your phone or iPad: + → Create from QR code. Anyone who sees this code can use this profile, so keep it private.' })); }
    catch (err) { s.body.append(h('p.error-text', { text: err.message })); }
  } else if (bad) s.body.append(h('p.error-text', { text: 'This profile has problems to fix before it can be used.' }));
  s.body.append(h('h3', { text: 'Checks', style: { margin: '8px 0 8px' } }), h('ul.checks', res.map(r => h('li.' + r.level, { text: r.text }))));
  let shown = false;
  const pre = h('pre.conf');
  const draw = () => { pre.textContent = shown ? conf : conf.replace(/^(PrivateKey|PresharedKey) = .+$/gm, '$1 = •••••••• (hidden)'); };
  draw();
  s.body.append(h('div.card-head', { style: { marginTop: '16px' } }, h('h3', { text: 'Configuration' }), h('button.btn.btn-sm.btn-ghost', { type: 'button', text: 'Show keys', onclick: e => { shown = !shown; e.currentTarget.textContent = shown ? 'Hide keys' : 'Show keys'; draw(); } })), pre,
    h('div.key-row', { style: { marginTop: '10px' } }, h('span.label', { text: 'This device’s public key' }), h('code', { text: validKey(p.privateKey) ? publicFromPrivate(p.privateKey) : '—' }),
      h('button.btn.btn-sm', { type: 'button', onclick: () => copy(publicFromPrivate(p.privateKey), 'Public key copied. Add it to the server as a peer.') }, icon('copy', 14), 'Copy')));
  s.foot.append(
    h('button.btn.btn-danger.left', { type: 'button', text: 'Delete', onclick: async () => { if (await confirmSheet('Delete “' + p.name + '”?', 'The profile and its private key are removed from Satchel. Devices that already imported it keep working until you remove the peer from the server.', { confirmLabel: 'Delete profile' })) { D().profiles = D().profiles.filter(x => x.id !== p.id); s.close(); changed(); } } }),
    h('button.btn', { type: 'button', text: 'Edit', onclick: () => { s.close(); editProfile(p); } }),
    h('button.btn', { type: 'button', disabled: bad, onclick: () => copy(conf, 'Configuration copied.') }, icon('copy', 15), 'Copy'),
    focus !== 'qr' && !bad ? h('button.btn', { type: 'button', onclick: () => { s.close(); detail(p, 'qr'); } }, icon('qr', 15), 'QR code') : null,
    h('button.btn.btn-accent', { type: 'button', disabled: bad, onclick: () => saveConf(p) }, icon('download', 15), 'Download .conf'));
}
async function copy(text, msg) { try { await navigator.clipboard.writeText(text); toast(msg); } catch { toast('Copying is blocked here. Use Download instead.', { error: true }); } }

// ---------- new and edit ----------
function newProfile() {
  const s = sheet('Add a profile');
  s.body.append(h('div.choice',
    h('button', { type: 'button', onclick: () => { s.close(); importProfile(); } }, icon('upload'), h('span', h('b', { text: 'Import a config from a VPN provider or server' }), h('span', { text: 'Paste or open a WireGuard .conf file. Good for changing location with a commercial VPN.' }))),
    h('button', { type: 'button', onclick: () => { s.close(); serverDevice(); } }, icon('key'), h('span', h('b', { text: 'Add a device to my own server' }), h('span', { text: 'Tunnel makes the keys and the server settings for a WireGuard server you run on a VPS or at home.' }))),
    h('button', { type: 'button', onclick: () => { s.close(); editProfile(null); } }, icon('edit'), h('span', h('b', { text: 'Enter the details by hand' }), h('span', { text: 'Fill in each field yourself. Tunnel can generate this device’s keys.' })))));
  s.foot.append(h('button.btn', { type: 'button', text: 'Cancel', onclick: () => s.close() }));
}
function metaFields(p) {
  const name = h('input.input', { maxlength: 60, required: true, value: p.name || '', placeholder: 'e.g. Toronto · iPad' });
  const location = h('input.input', { maxlength: 60, value: p.location || '', placeholder: 'e.g. Frankfurt, Germany' });
  const device = h('select.input', h('option', { value: '', text: 'Any device' }), DEVICES.map(d => h('option', { value: d, text: d })));
  device.value = p.device || '';
  return { name, location, device, el: h('div', h('label.field', h('span', { text: 'Profile name' }), name), h('div.grid-2', h('label.field', h('span', { text: 'Server location' }), location), h('label.field', h('span', { text: 'For device' }), device))) };
}
function importProfile() {
  const s = sheet('Import a WireGuard config', { wide: true });
  const meta = metaFields({});
  const text = h('textarea.input.conf-input', { placeholder: '[Interface]\nPrivateKey = …\nAddress = …\nDNS = …\n\n[Peer]\nPublicKey = …\nAllowedIPs = 0.0.0.0/0, ::/0\nEndpoint = …', spellcheck: 'false', 'aria-label': 'Configuration text' });
  const open = h('button.btn.btn-sm', { type: 'button', onclick: async () => {
    const f = await pickFile('.conf,text/plain');
    if (!f) return;
    if (f.size > 64 * 1024) return toast('That file is too large to be a WireGuard config.', { error: true });
    text.value = await f.text();
    if (!meta.name.value) meta.name.value = f.name.replace(/\.conf$/i, '').slice(0, 60);
  } }, icon('upload', 14), 'Open .conf file');
  const form = h('form', { onsubmit: e => {
    e.preventDefault();
    const parsed = parseConfig(text.value);
    if (!parsed.privateKey && !parsed.peer.publicKey) return toast('That does not look like a WireGuard config (no [Interface] or [Peer]).', { error: true });
    const p = { id: uid(), name: meta.name.value.trim() || 'Imported profile', location: meta.location.value.trim(), device: meta.device.value, source: 'imported', createdAt: Date.now(), privateKey: parsed.privateKey, address: parsed.address, dns: parsed.dns, mtu: parsed.mtu, peer: parsed.peer };
    D().profiles.push(p); s.close(); changed();
    const notes = [];
    if (parsed.extraPeers) notes.push(`${parsed.extraPeers} extra [Peer] section${parsed.extraPeers === 1 ? ' was' : 's were'} ignored`);
    if (parsed.unknown.length) notes.push('unsupported settings ignored: ' + [...new Set(parsed.unknown)].join(', '));
    toast('Profile imported' + (notes.length ? ' (' + notes.join('; ') + ')' : '') + '.');
    detail(p, 'details');
  } }, meta.el, h('div.card-head', h('span.label', { text: 'Configuration' }), open), text, h('p.hint', { text: 'Most providers let you download a WireGuard config for a chosen server and country in their account area. The text stays on this device until you save it to your account.' }));
  s.body.append(form);
  s.foot.append(h('button.btn', { type: 'button', text: 'Cancel', onclick: () => s.close() }), h('button.btn.btn-accent', { type: 'button', text: 'Import', onclick: () => form.requestSubmit() }));
}
function editProfile(existing) {
  const p = existing ? JSON.parse(JSON.stringify(existing)) : { id: uid(), name: '', location: '', device: '', source: 'manual', createdAt: Date.now(), privateKey: '', address: '10.8.0.2/32', dns: '1.1.1.1, 1.0.0.1', mtu: null, peer: { publicKey: '', presharedKey: '', allowedIPs: '0.0.0.0/0, ::/0', endpoint: '', keepalive: 25 } };
  const s = sheet(existing ? 'Edit profile' : 'New profile', { wide: true });
  const meta = metaFields(p);
  const f = {
    privateKey: h('input.input', { value: p.privateKey, spellcheck: 'false', autocomplete: 'off', placeholder: 'Base64 key, 44 characters' }),
    address: h('input.input', { value: p.address, placeholder: '10.8.0.2/32' }),
    dns: h('input.input', { value: p.dns, placeholder: '1.1.1.1' }),
    mtu: h('input.input', { type: 'number', min: 1280, max: 1500, value: p.mtu || '', placeholder: 'Automatic' }),
    pub: h('input.input', { value: p.peer.publicKey, spellcheck: 'false', autocomplete: 'off' }),
    psk: h('input.input', { value: p.peer.presharedKey || '', spellcheck: 'false', autocomplete: 'off', placeholder: 'Optional' }),
    endpoint: h('input.input', { value: p.peer.endpoint, placeholder: 'vpn.example.com:51820' }),
    allowed: h('input.input', { value: p.peer.allowedIPs }),
    keepalive: h('input.input', { type: 'number', min: 0, max: 600, value: p.peer.keepalive || '' }),
  };
  const gen = h('button.btn.btn-sm', { type: 'button', onclick: async () => { const kp = await generateKeyPair(); f.privateKey.value = kp.privateKey; toast('New key pair made. Add this device’s public key to the server: ' + kp.publicKey.slice(0, 12) + '…'); } }, icon('key', 14), 'Generate');
  const form = h('form', { onsubmit: e => {
    e.preventDefault();
    Object.assign(p, { name: meta.name.value.trim() || 'Profile', location: meta.location.value.trim(), device: meta.device.value, privateKey: f.privateKey.value.trim(), address: f.address.value.trim(), dns: f.dns.value.trim(), mtu: Number(f.mtu.value) || null });
    Object.assign(p.peer, { publicKey: f.pub.value.trim(), presharedKey: f.psk.value.trim(), endpoint: f.endpoint.value.trim(), allowedIPs: f.allowed.value.trim(), keepalive: Number(f.keepalive.value) || null });
    if (existing) Object.assign(D().profiles.find(x => x.id === existing.id), p); else D().profiles.push(p);
    s.close(); changed(); detail(p, 'details');
  } }, meta.el,
  h('h3', { text: 'This device', style: { margin: '6px 0 8px' } }),
  h('label.field', h('span', { text: 'Private key' }), h('div.row', f.privateKey, gen)),
  h('div.grid-3', h('label.field', h('span', { text: 'Address' }), f.address), h('label.field', h('span', { text: 'DNS' }), f.dns), h('label.field', h('span', { text: 'MTU' }), f.mtu)),
  h('h3', { text: 'Server', style: { margin: '6px 0 8px' } }),
  h('div.grid-2', h('label.field', h('span', { text: 'Server public key' }), f.pub), h('label.field', h('span', { text: 'Endpoint (host:port)' }), f.endpoint)),
  h('div.grid-3', h('label.field', h('span', { text: 'Allowed IPs' }), f.allowed), h('label.field', h('span', { text: 'Preshared key' }), f.psk), h('label.field', h('span', { text: 'Keepalive (seconds)' }), f.keepalive)));
  f.privateKey.style.flex = '1'; f.privateKey.style.width = 'auto';
  s.body.append(form);
  s.foot.append(h('button.btn', { type: 'button', text: 'Cancel', onclick: () => s.close() }), h('button.btn.btn-accent', { type: 'button', text: 'Save', onclick: () => form.requestSubmit() }));
}

// ---------- own server ----------
function nextIp() {
  const used = new Set(D().profiles.filter(p => p.source === 'server').map(p => p.address.split('/')[0]));
  const base = D().server.address.split('/')[0].split('.').slice(0, 3).join('.');
  for (let i = 2; i < 255; i++) if (!used.has(`${base}.${i}`)) return `${base}.${i}`;
  return null;
}
async function serverDevice() {
  if (!D().server) { await serverSetup(true); return; }
  const s = sheet('Add a device to ' + (D().server.name || 'my server'));
  const meta = metaFields({ location: D().server.location || '' });
  const dns = h('select.input', DNS_CHOICES.map(([v, l]) => h('option', { value: v, text: l })));
  const full = h('input', { type: 'checkbox', checked: true });
  const form = h('form', { onsubmit: async e => {
    e.preventDefault();
    const ip = nextIp();
    if (!ip) return toast('This server has no free addresses left.', { error: true });
    const kp = await generateKeyPair();
    const p = { id: uid(), name: meta.name.value.trim() || 'Device', location: meta.location.value.trim(), device: meta.device.value, source: 'server', createdAt: Date.now(), privateKey: kp.privateKey, address: ip + '/32', dns: dns.value, mtu: null,
      peer: { publicKey: D().server.publicKey, presharedKey: generatePresharedKey(), allowedIPs: full.checked ? '0.0.0.0/0, ::/0' : D().server.address.replace(/\.\d+\//, '.0/'), endpoint: `${D().server.host}:${D().server.port}`, keepalive: 25 } };
    D().profiles.push(p); s.close(); state.tab = 'server'; changed();
    toast('Device added. Update the server config (shown below) so the server accepts it.', { ms: 9000 });
  } }, meta.el, h('label.field', h('span', { text: 'DNS for this device' }), dns), h('label.check', full, 'Send all traffic through the server (needed for Wi-Fi privacy and changing location)'));
  s.body.append(form);
  s.foot.append(h('button.btn', { type: 'button', text: 'Cancel', onclick: () => s.close() }), h('button.btn.btn-accent', { type: 'button', text: 'Create keys and profile', onclick: () => form.requestSubmit() }));
}
async function serverSetup(thenAddDevice) {
  const srv = D().server || {};
  const s = sheet(D().server ? 'Server settings' : 'Set up my server');
  const name = h('input.input', { maxlength: 60, value: srv.name || 'My server', required: true });
  const host = h('input.input', { value: srv.host || '', required: true, placeholder: 'Public IP or domain, e.g. 203.0.113.5' });
  const port = h('input.input', { type: 'number', min: 1, max: 65535, value: srv.port || 51820 });
  const location = h('input.input', { maxlength: 60, value: srv.location || '', placeholder: 'e.g. Frankfurt, Germany' });
  const subnet = h('input.input', { value: srv.address || '10.8.0.1/24', disabled: !!D().server });
  const nic = h('input.input', { value: srv.nic || 'eth0', placeholder: 'eth0' });
  const form = h('form', { onsubmit: async e => {
    e.preventDefault();
    if (!validEndpoint(host.value.trim() + ':' + (Number(port.value) || 51820))) return toast('Enter the server’s public IP address or domain name.', { error: true });
    if (!/^(\d{1,3}\.){3}1\/24$/.test(subnet.value.trim())) return toast('Use a private /24 address ending in .1, such as 10.8.0.1/24.', { error: true });
    let keys = D().server ? { privateKey: D().server.privateKey, publicKey: D().server.publicKey } : await generateKeyPair();
    D().server = { name: name.value.trim() || 'My server', host: host.value.trim(), port: Number(port.value) || 51820, location: location.value.trim(), address: subnet.value.trim(), nic: nic.value.trim() || 'eth0', ...keys };
    for (const p of D().profiles.filter(x => x.source === 'server')) { p.peer.endpoint = `${D().server.host}:${D().server.port}`; p.peer.publicKey = D().server.publicKey; }
    s.close(); store.changed();
    if (thenAddDevice) serverDevice(); else render();
  } },
  h('p.hint', { text: 'You need a Linux server with a public IP address: a small VPS (a few dollars a month) in the country you want to appear from, or a computer at home with port forwarding.' }),
  h('div.grid-2', h('label.field', h('span', { text: 'Name' }), name), h('label.field', h('span', { text: 'Location' }), location)),
  h('div.grid-2', h('label.field', h('span', { text: 'Public address' }), host), h('label.field', h('span', { text: 'UDP port' }), port)),
  h('div.grid-2', h('label.field', h('span', { text: 'VPN subnet' }), subnet), h('label.field', h('span', { text: 'Network interface' }), nic)));
  s.body.append(form);
  s.foot.append(h('button.btn', { type: 'button', text: 'Cancel', onclick: () => s.close() }), h('button.btn.btn-accent', { type: 'button', text: D().server ? 'Save' : 'Create server keys', onclick: () => form.requestSubmit() }));
}
function server(v) {
  v.append(h('div.page-head', h('div', h('h1', { text: 'My server' }), h('p', { text: 'Run your own WireGuard server and add each of your devices to it.' })), D().server ? h('div.row', h('button.btn', { type: 'button', text: 'Server settings', onclick: () => serverSetup(false) }), h('button.btn.btn-accent', { type: 'button', onclick: serverDevice }, icon('plus', 15), 'Add device')) : null));
  if (!D().server) {
    v.append(h('section.card', h('div.empty-state', h('h3', { text: 'No server yet' }), h('p', { text: 'Using a VPN provider instead? Import their config under Profiles. To run your own, start here.' }), h('button.btn.btn-accent', { type: 'button', text: 'Set up my server', onclick: () => serverSetup(false) }))));
    return;
  }
  const srv = D().server;
  const clients = D().profiles.filter(p => p.source === 'server' && validKey(p.privateKey)).map(p => ({ name: p.name, publicKey: publicFromPrivate(p.privateKey), presharedKey: p.peer.presharedKey, ip: p.address }));
  const conf = serverConfig({ serverPrivateKey: srv.privateKey, serverAddress: srv.address, listenPort: srv.port, clients, nic: srv.nic });
  let shown = false;
  const pre = h('pre.conf');
  const draw = () => { pre.textContent = shown ? conf : conf.replace(/^(PrivateKey|PresharedKey) = .+$/gm, '$1 = •••••••• (hidden)'); };
  draw();
  v.append(h('section.card', h('div.card-head', h('h2', { text: `${srv.name}${srv.location ? ' · ' + srv.location : ''}` }), h('span.pill', { text: `${srv.host}:${srv.port}` })),
    h('ul.list', clients.length ? clients.map(c => h('li.list-row', h('span.grow', h('div.title', { text: c.name }), h('div.sub', { text: c.ip })))) : [h('li.list-row', h('span.muted', { text: 'No devices yet. Use “Add device”.' }))])));
  const cmd = (...lines) => h('pre.conf', { text: lines.join('\n') });
  v.append(h('section.card', h('h2', { text: 'Set up the server (Ubuntu or Debian)', style: { marginBottom: '10px' } }),
    h('ol.steps-list',
      h('li', 'Rent a small Linux VPS in the country you want to appear from (or use a home machine), and sign in to it over SSH.'),
      h('li', 'Install WireGuard and turn on packet forwarding:', cmd('sudo apt update && sudo apt install -y wireguard', "echo 'net.ipv4.ip_forward=1' | sudo tee /etc/sysctl.d/99-wireguard.conf", 'sudo sysctl --system')),
      h('li', 'Create the server config. Open the file, paste the configuration below, and save:', cmd('sudo nano /etc/wireguard/wg0.conf', 'sudo chmod 600 /etc/wireguard/wg0.conf')),
      h('li', 'Open the UDP port and start WireGuard (it also starts after a reboot):', cmd(`sudo ufw allow ${srv.port}/udp`, 'sudo systemctl enable --now wg-quick@wg0')),
      h('li', 'After adding a device in Tunnel, paste the updated configuration into wg0.conf again and reload:', cmd('sudo systemctl restart wg-quick@wg0')),
      h('li', 'Check that devices connect:', cmd('sudo wg show')))));
  v.append(h('section.card', h('div.card-head', h('h2', { text: 'Server configuration (wg0.conf)' }), h('div.row',
    h('button.btn.btn-sm.btn-ghost', { type: 'button', text: 'Show keys', onclick: e => { shown = !shown; e.currentTarget.textContent = shown ? 'Hide keys' : 'Show keys'; draw(); } }),
    h('button.btn.btn-sm', { type: 'button', onclick: () => copy(conf, 'Server configuration copied.') }, icon('copy', 14), 'Copy'),
    h('button.btn.btn-sm', { type: 'button', onclick: () => download('wg0.conf', conf, 'text/plain') }, icon('download', 14), 'Download'))), pre,
    h('p.hint', { style: { marginTop: '8px' }, text: `The network interface is set to “${srv.nic}”. If your server uses another name (check with: ip route | grep default), change it in Server settings.` })));
}

// ---------- help ----------
function help(v) {
  v.append(h('div.page-head', h('div', h('h1', { text: 'How to connect' }), h('p', { text: 'Install the free WireGuard app once on each device, then add a profile from Tunnel.' }))));
  const card = (title, steps) => h('section.card', h('h2', { text: title, style: { marginBottom: '10px' } }), h('ol.steps-list', steps.map(s => h('li', { text: s }))));
  v.append(h('div.cards',
    card('iPhone and iPad', ['Install “WireGuard” from the App Store (by WireGuard Development Team).', 'In Tunnel, open the profile and choose QR code.', 'In the app, tap + → Create from QR code, scan it and give it a name.', 'Allow the VPN configuration when iOS asks, then switch the tunnel on.', 'Optional: in the tunnel’s settings, turn on “On-Demand” for Wi-Fi so it connects automatically on public networks.']),
    card('Android', ['Install “WireGuard” from Google Play.', 'Tap + → Scan from QR code and scan the profile’s QR code.', 'Switch the tunnel on and accept the connection request.', 'Optional: Settings → Network → VPN → WireGuard → Always-on VPN.']),
    card('Windows and Mac', ['Download WireGuard from wireguard.com/install (Mac: the App Store).', 'In Tunnel, choose Download .conf on the profile.', 'In WireGuard, choose “Import tunnel(s) from file” and pick the file.', 'Click Activate.']),
    card('Check that it works', ['With the tunnel on, open any “what is my IP” website.', 'It should show the server’s location, not yours.', 'For a DNS leak test, search for “DNS leak test”; only your chosen DNS provider should appear.', 'If pages will not load, try MTU 1280 in the profile and import it again.'])));
  v.append(h('section.card', h('h2', { text: 'Good to know', style: { marginBottom: '8px' } }), h('ul.steps-list',
    h('li', 'A VPN hides your traffic from the local Wi-Fi and changes the location websites see. It does not make you anonymous to the VPN server or to sites you sign in to.'),
    h('li', 'Use one profile per device. Two devices sharing a profile will knock each other off.'),
    h('li', 'If a device is lost, delete its profile here and remove its peer from the server (or ask your provider to revoke the key).'),
    h('li', 'Streaming services and some schools or workplaces block VPNs or forbid them in their terms. Check the rules where you use it.'))));
}

// ---------- start ----------
$('add-btn').append(icon('plus', 16), 'Add profile');
$('add-btn').addEventListener('click', newProfile);
onShellNavigate(() => render());
(async () => {
  try { await store.load(); render(); }
  catch (err) { toast('Tunnel could not load: ' + err.message, { error: true, ms: 20000 }); }
})();
