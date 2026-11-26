// Account self-service: profile, password, sessions, access tokens, data export and deletion.
// All server text is written with textContent; nothing here builds HTML from data.
// Accounts created with Google have no password: they can set one here, and confirm
// sensitive actions by continuing with Google again instead of typing a password.
import { api } from './api.js';
import { attachMeter, attachMatch, weakReason, MIN_LENGTH } from './password-strength.js';
import { drawQr } from './qr-canvas.js';

const $ = id => document.getElementById(id);
const errorBox = $('acct-error');
const noticeBox = $('acct-notice');
let hasPassword = true;
let zoneTouched = false;

const meter = attachMeter($('pw-new'), { minLength: MIN_LENGTH });
const match = attachMatch($('pw-new'), $('pw-confirm'), $('pw-confirm-hint'));
// Two-step sign-in state. view: 'idle' (status + start/manage forms) | 'enrol' (QR step) | 'codes' (recovery codes).
const mfa = { enabled: false, view: 'idle', setupRequired: new URLSearchParams(window.location.search).get('setup-mfa') === '1', operatorRequires: false, codes: [] };
api('/api/auth/config').then(c => {
  meter.setMinLength(c.passwordMinLength);
  mfa.operatorRequires = !!c.mfaRequired;
  updateMfaView();
}).catch(() => { /* default is fine */ });

function showError(msg, code) {
  noticeBox.classList.remove('show');
  errorBox.textContent = msg;
  if (code === 'reauth_google') {
    // No password to retype: a fresh Google sign-in confirms it is the account owner.
    const link = document.createElement('a');
    link.className = 'btn btn-sm';
    link.href = '/api/auth/google/start?intent=reauth&next=' + encodeURIComponent('/account');
    link.textContent = 'Continue with Google';
    const row = document.createElement('p');
    row.style.marginTop = '10px';
    row.append(link);
    errorBox.append(row);
  }
  errorBox.classList.add('show');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function showNotice(msg) { errorBox.classList.remove('show'); noticeBox.textContent = msg; noticeBox.classList.add('show'); window.scrollTo({ top: 0, behavior: 'smooth' }); }
function clearMessages() { errorBox.classList.remove('show'); noticeBox.classList.remove('show'); }

// A 401 anywhere means the session ended (idle timeout, password change elsewhere, revoked).
async function call(path, options) {
  try { return await api(path, options); }
  catch (err) {
    if (err.status === 401) { window.location.href = '/auth?next=' + encodeURIComponent('/account'); }
    throw err;
  }
}

const when = ts => (ts ? new Date(ts).toLocaleString() : 'never');
function bytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

async function loadAccount() {
  const { account } = await call('/api/account');
  $('acct-email').textContent = account.email;
  $('acct-methods').textContent = [account.hasPassword && 'Email and password', account.google && 'Google'].filter(Boolean).join(', ') || 'Email and password';
  setPasswordMode(account.hasPassword);
  renderMfa(account);
  $('acct-created').textContent = when(account.createdAt);
  $('acct-last').textContent = when(account.lastLoginAt);
  $('acct-consent').textContent = account.consent
    ? 'version ' + account.consent.version + ', ' + when(account.consent.at)
    : 'before consent was recorded';
  $('acct-name').value = account.name;
  showPhoto(account.avatar, account.name || account.email);
  if (!zoneTouched) { $('acct-zone').value = account.timeZone || deviceZone(); showZoneNow(); }
  const s = account.storage, c = s.counts;
  $('storage-line').textContent = 'Storing ' + (c.notes || 0) + ' note(s), ' + (c.appdocs || 0) + ' app workspace(s) and ' + (c.calendars || 0) + ' calendar: '
    + bytes(s.usedBytes) + (s.limitBytes ? ' of ' + bytes(s.limitBytes) : '') + ' used.';
}

// Google-only accounts "set" a first password instead of changing one.
function setPasswordMode(withPassword) {
  hasPassword = withPassword;
  $('h-password').textContent = withPassword ? 'Change password' : 'Set a password';
  $('pw-intro').textContent = withPassword
    ? 'Changing your password signs you out everywhere else.'
    : 'You sign in with Google. Add a password to also sign in with your email address. This signs you out everywhere else.';
  $('pw-current-field').hidden = !withPassword;
  $('pw-submit').textContent = withPassword ? 'Change password' : 'Set password';
  $('del-password-field').hidden = !withPassword;
  $('del-password').required = withPassword;
  $('del-google-note').hidden = withPassword;
  for (const id of ['mfa-start-pw-field', 'mfa-regen-pw-field', 'mfa-disable-pw-field', 'token-pw-field']) $(id).hidden = !withPassword;
}

// ---------- two-step sign-in ----------
let mfaScrolled = false;
function renderMfa(account) {
  const m = account.mfa || { enabled: false, enrolledAt: null, recoveryRemaining: 0 };
  mfa.enabled = !!m.enabled;
  if (account.mfaSetupRequired) mfa.setupRequired = true;
  const n = m.recoveryRemaining || 0;
  $('mfa-status').textContent = m.enabled
    ? 'On since ' + (m.enrolledAt ? new Date(m.enrolledAt).toLocaleDateString() : 'earlier') + '. ' + n + ' recovery code' + (n === 1 ? '' : 's') + ' left.'
    : 'Off. Add a code from an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, ...) when you sign in.';
  if (m.enabled) mfa.setupRequired = false;
  updateMfaView();
  if (mfa.setupRequired && !mfaScrolled) {
    mfaScrolled = true;
    $('mfa-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function updateMfaView() {
  const idle = mfa.view === 'idle';
  $('mfa-required-note').hidden = !mfa.setupRequired;
  $('mfa-start-form').hidden = !(idle && !mfa.enabled);
  $('mfa-manage').hidden = !(idle && mfa.enabled);
  $('mfa-disable-form').hidden = mfa.operatorRequires;
  $('mfa-enrol').hidden = mfa.view !== 'enrol';
  $('mfa-codes').hidden = mfa.view !== 'codes';
}

function showCodes(codes, afterSetup) {
  mfa.codes = codes;
  mfa.view = 'codes';
  const list = $('mfa-code-list');
  list.replaceChildren();
  for (const c of codes) {
    const li = document.createElement('li');
    li.textContent = c;
    list.append(li);
  }
  $('mfa-continue').hidden = !(afterSetup && mfa.setupRequired);
  updateMfaView();
  $('mfa-codes').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); showNotice('Copied.'); } catch { /* clipboard may be blocked */ }
}

const needsPassword = () => hasPassword;
function reauthBody(inputId) {
  return needsPassword() ? { currentPassword: $(inputId).value } : {};
}
function checkPassword(inputId) {
  if (needsPassword() && !$(inputId).value) { $(inputId).focus(); showError('Enter your current password.'); return false; }
  return true;
}
function cleanCode(v) { return v.trim(); }
function mfaFail(err, input) {
  const code = err.data && err.data.code;
  if (code === 'mfa_no_setup') {
    mfa.view = 'idle';
    updateMfaView();
    return showError('Your setup expired. Start again.', code);
  }
  if (code === 'mfa_already_enabled') { mfa.view = 'idle'; loadAccount().catch(() => {}); }
  if (code === 'mfa_required') { mfa.operatorRequires = true; updateMfaView(); }
  if (input && code === 'mfa_invalid') input.focus();
  showError(err.message, code);
}

$('mfa-start-form').addEventListener('submit', async e => {
  e.preventDefault(); clearMessages();
  if (!checkPassword('mfa-start-pw')) return;
  const btn = $('mfa-start-btn'); btn.disabled = true;
  try {
    const res = await call('/api/account/mfa/setup', { method: 'POST', body: reauthBody('mfa-start-pw') });
    $('mfa-start-pw').value = '';
    drawQr($('mfa-qr'), res.qr);
    $('mfa-secret').textContent = res.secret;
    $('mfa-enable-code').value = '';
    mfa.view = 'enrol';
    updateMfaView();
    $('mfa-enable-code').focus();
  } catch (err) { mfaFail(err); }
  finally { btn.disabled = false; }
});

$('mfa-copy-key').addEventListener('click', () => copyText($('mfa-secret').textContent));

$('mfa-enable-form').addEventListener('submit', async e => {
  e.preventDefault(); clearMessages();
  const input = $('mfa-enable-code');
  const code = cleanCode(input.value);
  if (!code) { input.focus(); return showError('Enter the 6-digit code from your authenticator app.'); }
  const btn = $('mfa-enable-btn'); btn.disabled = true;
  try {
    const res = await call('/api/account/mfa/enable', { method: 'POST', body: { code } });
    input.value = '';
    $('mfa-secret').textContent = '';
    const wasRequired = mfa.setupRequired;
    showCodes(res.recoveryCodes || [], true);
    mfa.setupRequired = wasRequired;
    $('mfa-continue').hidden = !wasRequired;
    const { account } = await call('/api/account');
    mfa.enabled = !!(account.mfa && account.mfa.enabled);
    const n = (account.mfa && account.mfa.recoveryRemaining) || 0;
    $('mfa-status').textContent = 'On since ' + new Date((account.mfa && account.mfa.enrolledAt) || Date.now()).toLocaleDateString() + '. ' + n + ' recovery code' + (n === 1 ? '' : 's') + ' left.';
  } catch (err) { mfaFail(err, input); }
  finally { btn.disabled = false; }
});

$('mfa-regen-form').addEventListener('submit', async e => {
  e.preventDefault(); clearMessages();
  if (!checkPassword('mfa-regen-pw')) return;
  const input = $('mfa-regen-code');
  const code = cleanCode(input.value);
  if (!code) { input.focus(); return showError('Enter the 6-digit code from your authenticator app.'); }
  try {
    const res = await call('/api/account/mfa/recovery-codes', { method: 'POST', body: { ...reauthBody('mfa-regen-pw'), code } });
    $('mfa-regen-pw').value = ''; input.value = '';
    showCodes(res.recoveryCodes || [], false);
  } catch (err) { mfaFail(err, input); }
});

$('mfa-disable-form').addEventListener('submit', async e => {
  e.preventDefault(); clearMessages();
  if (!checkPassword('mfa-disable-pw')) return;
  const input = $('mfa-disable-code');
  const code = cleanCode(input.value);
  if (!code) { input.focus(); return showError('Enter an authenticator code or a recovery code.'); }
  try {
    await call('/api/account/mfa/disable', { method: 'POST', body: { ...reauthBody('mfa-disable-pw'), code } });
    $('mfa-disable-pw').value = ''; input.value = '';
    showNotice('Two-step sign-in is off.');
    await loadAccount();
  } catch (err) { mfaFail(err, input); }
});

function codesText() {
  return 'Satchel recovery codes\nEach code works once.\n\n' + mfa.codes.join('\n') + '\n';
}
$('mfa-download').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([codesText()], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url; a.download = 'satchel-recovery-codes.txt';
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
});
$('mfa-copy-codes').addEventListener('click', () => copyText(mfa.codes.join('\n')));
$('mfa-saved').addEventListener('click', async () => {
  mfa.codes = [];
  $('mfa-code-list').replaceChildren();
  mfa.view = 'idle';
  updateMfaView();
  try { await loadAccount(); } catch { /* shown elsewhere */ }
});

async function loadSessions() {
  const { sessions } = await call('/api/account/sessions');
  const list = $('sessions-list');
  list.replaceChildren();
  for (const s of sessions) {
    const li = document.createElement('li');
    const info = document.createElement('div');
    const agent = document.createElement('strong');
    agent.textContent = s.agent || 'Unknown browser';
    const detail = document.createElement('span');
    detail.className = 'muted';
    detail.textContent = ' · ' + (s.ip || 'unknown address') + ' · last active ' + when(s.lastSeen)
      + (s.method === 'google' ? ' · signed in with Google' : '');
    info.append(agent, detail);
    li.append(info);
    if (s.current) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = 'this device';
      li.append(badge);
    } else {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-ghost btn-sm';
      btn.textContent = 'End session';
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try { await call('/api/account/sessions/' + encodeURIComponent(s.id), { method: 'DELETE' }); await loadSessions(); }
        catch (err) { showError(err.message); btn.disabled = false; }
      });
      li.append(btn);
    }
    list.append(li);
  }
}

// ---------- access tokens ----------
const SCOPE_LABEL = { 'read': 'read', 'read,write': 'read and change', 'write': 'change' };
async function loadTokens() {
  const { tokens } = await call('/api/account/tokens');
  const list = $('tokens-list');
  list.replaceChildren();
  $('tokens-empty').hidden = tokens.length > 0;
  for (const t of tokens) {
    const li = document.createElement('li');
    const info = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = t.name;
    const meta = document.createElement('span');
    meta.className = 'muted token-meta';
    meta.textContent = t.hint + '… · ' + (SCOPE_LABEL[t.scopes.join(',')] || t.scopes.join(', '))
      + ' · created ' + when(t.createdAt) + ' · last used ' + when(t.lastUsedAt)
      + ' · ' + (t.expiresAt ? (t.expired ? 'expired ' : 'expires ') + new Date(t.expiresAt).toLocaleDateString() : 'never expires');
    info.append(name, meta);
    const actions = document.createElement('div');
    actions.className = 'token-row-actions';
    if (t.expired) {
      const badge = document.createElement('span');
      badge.className = 'badge badge-warn';
      badge.textContent = 'expired';
      actions.append(badge);
    }
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-ghost btn-sm';
    btn.textContent = 'Revoke';
    btn.setAttribute('aria-label', 'Revoke token ' + t.name);
    btn.addEventListener('click', async () => {
      if (!window.confirm('Revoke "' + t.name + '"? Tools using it stop working at once.')) return;
      btn.disabled = true; clearMessages();
      try { await call('/api/account/tokens/' + encodeURIComponent(t.id), { method: 'DELETE' }); showNotice('Token revoked.'); await loadTokens(); }
      catch (err) { showError(err.message); btn.disabled = false; }
    });
    actions.append(btn);
    li.append(info, actions);
    list.append(li);
  }
}

$('token-form').addEventListener('submit', async e => {
  e.preventDefault(); clearMessages();
  const name = $('token-name').value.trim();
  if (!name) { $('token-name').focus(); return showError('Give the token a name, such as the tool and computer it is for.'); }
  if (!checkPassword('token-pw')) return;
  const btn = $('token-create-btn'); btn.disabled = true;
  try {
    const res = await call('/api/account/tokens', { method: 'POST', body: {
      ...reauthBody('token-pw'), name,
      scopes: $('token-access').value.split(','),
      expiresInDays: Number($('token-expiry').value),
    } });
    $('token-pw').value = ''; $('token-name').value = '';
    $('token-secret').textContent = res.token;
    $('token-created').hidden = false;
    $('token-form').hidden = true;
    $('token-created').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    await loadTokens();
  } catch (err) { showError(err.message, err.data && err.data.code); }
  finally { btn.disabled = false; }
});
$('token-copy').addEventListener('click', () => copyText($('token-secret').textContent));
$('token-done').addEventListener('click', () => {
  $('token-secret').textContent = '';
  $('token-created').hidden = true;
  $('token-form').hidden = false;
});

$('name-form').addEventListener('submit', async e => {
  e.preventDefault(); clearMessages();
  try {
    await call('/api/account', { method: 'PATCH', body: { name: $('acct-name').value } });
    showNotice('Name updated.');
    tellShell();
    loadAccount().catch(() => {});
  } catch (err) { showError(err.message); }
});

$('password-form').addEventListener('submit', async e => {
  e.preventDefault(); clearMessages();
  const next = $('pw-new').value;
  if (hasPassword && !$('pw-current').value) { $('pw-current').focus(); return showError('Enter your current password.'); }
  const weak = weakReason(next);
  if (weak) { $('pw-new').focus(); return showError(weak); }
  if (next !== $('pw-confirm').value) { $('pw-confirm').focus(); return showError('The two new passwords do not match.'); }
  try {
    const body = { newPassword: next };
    if (hasPassword) body.currentPassword = $('pw-current').value;
    const res = await call('/api/account/password', { method: 'POST', body });
    $('pw-current').value = ''; $('pw-new').value = ''; $('pw-confirm').value = '';
    meter.update(); match.update();
    showNotice((res.firstPassword ? 'Password set. You can now also sign in with your email address and password.' : 'Password changed.')
      + (res.otherSessionsRevoked ? ' ' + res.otherSessionsRevoked + ' other session(s) signed out.' : ''));
    await Promise.all([loadAccount(), loadSessions()]);
  } catch (err) { showError(err.message, err.data && err.data.code); }
});

$('revoke-others-btn').addEventListener('click', async () => {
  clearMessages();
  try {
    const res = await call('/api/account/sessions/revoke-others', { method: 'POST' });
    showNotice(res.revoked + ' other session(s) signed out.');
    await loadSessions();
  } catch (err) { showError(err.message); }
});

$('export-btn').addEventListener('click', async () => {
  clearMessages();
  const btn = $('export-btn'); btn.disabled = true;
  try {
    const res = await fetch('/api/account/export', { credentials: 'same-origin', headers: { 'X-Requested-With': 'satchel' } });
    if (res.status === 401) { window.location.href = '/auth?next=' + encodeURIComponent('/account'); return; }
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Export failed.');
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url; a.download = 'satchel-account-export.json';
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    showNotice('Your data was downloaded.');
  } catch (err) { showError(err.message); }
  finally { btn.disabled = false; }
});

$('delete-form').addEventListener('submit', async e => {
  e.preventDefault(); clearMessages();
  if ($('del-confirm').value !== 'DELETE') return showError('Type DELETE (capital letters) to confirm.');
  if (!window.confirm('Permanently delete your account and everything in it?')) return;
  try {
    const body = { confirm: $('del-confirm').value };
    if (hasPassword) body.currentPassword = $('del-password').value;
    await call('/api/account', { method: 'DELETE', body });
    window.location.href = '/';
  } catch (err) { showError(err.message, err.data && err.data.code); }
});

// Sign out of Satchel (every app). Inside the shell the whole window goes to the sign-in page.
async function signOut(e) {
  e.preventDefault();
  try { await api('/api/auth/logout', { method: 'POST' }); } finally { try { window.top.location.href = '/'; } catch { window.location.href = '/'; } }
}
$('signout-btn').addEventListener('click', signOut);
$('signout-main').addEventListener('click', signOut);

// ---------- Satchel-wide settings: photo and time zone ----------
// Tell the shell (when this page is inside it) so the sidebar and open apps update at once.
function tellShell() { try { if (window.SatchelTabs && window.SatchelTabs.settingsChanged) window.SatchelTabs.settingsChanged(); } catch { /* ignore */ } }

function deviceZone() { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } }
function knownZone(z) { if (!z || z.length > 64) return false; try { new Intl.DateTimeFormat('en-CA', { timeZone: z }); return true; } catch { return false; } }
try {
  const list = $('zone-list');
  for (const z of (Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : [])) { const o = document.createElement('option'); o.value = z; list.append(o); }
} catch { /* older browser: typing a zone still works */ }
function showZoneNow() {
  const z = $('acct-zone').value.trim();
  $('zone-now').textContent = knownZone(z)
    ? 'It is ' + new Date().toLocaleString(undefined, { timeZone: z, weekday: 'long', hour: 'numeric', minute: '2-digit' }) + ' there now.'
    : 'Choose a time zone from the list, such as America/Toronto or Europe/London.';
}
$('acct-zone').addEventListener('input', () => { zoneTouched = true; showZoneNow(); });
$('zone-device').addEventListener('click', () => { zoneTouched = true; $('acct-zone').value = deviceZone(); showZoneNow(); $('acct-zone').focus(); });
$('zone-form').addEventListener('submit', async e => {
  e.preventDefault(); clearMessages();
  const z = $('acct-zone').value.trim();
  if (!knownZone(z)) { showError('Choose a time zone from the list.'); return; }
  try {
    await call('/api/account', { method: 'PATCH', body: { timeZone: z } });
    zoneTouched = false;
    showNotice('Time zone saved. Every Satchel app now uses ' + z + '.');
    tellShell();
  } catch (err) { showError(err.message); }
});

function showPhoto(avatar, name) {
  const box = $('photo-preview');
  box.textContent = '';
  if (typeof avatar === 'string' && avatar.startsWith('data:image/')) {
    const img = document.createElement('img'); img.src = avatar; img.alt = ''; box.append(img);
  } else box.textContent = (String(name || '?').trim().charAt(0) || '?').toUpperCase();
  $('photo-remove').hidden = !avatar;
}

// The photo is cropped to a circle here in the browser and saved as a small 256 px JPEG.
const crop = { img: null, zoom: 1, x: 0, y: 0, drag: null };
const canvas = $('photo-canvas'), ctx = canvas.getContext('2d');
function coverScale() { return Math.max(canvas.width / crop.img.width, canvas.height / crop.img.height); }
function clampCrop() {
  const sc = coverScale() * crop.zoom, w = crop.img.width * sc, h = crop.img.height * sc;
  crop.x = Math.min(0, Math.max(canvas.width - w, crop.x));
  crop.y = Math.min(0, Math.max(canvas.height - h, crop.y));
}
function drawCrop() {
  if (!crop.img) return;
  clampCrop();
  const sc = coverScale() * crop.zoom;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(crop.img, crop.x, crop.y, crop.img.width * sc, crop.img.height * sc);
}
function closeEditor() { $('photo-editor').hidden = true; crop.img = null; $('photo-upload').disabled = false; }
$('photo-upload').addEventListener('click', () => {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'image/png,image/jpeg,image/webp';
  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    clearMessages();
    if (file.size > 15 * 1024 * 1024) { showError('Choose a photo smaller than 15 MB.'); return; }
    try {
      const img = await createImageBitmap(file);
      if (img.width < 32 || img.height < 32) throw new Error('small');
      crop.img = img; crop.zoom = 1; $('photo-zoom').value = '1';
      const sc = coverScale();
      crop.x = (canvas.width - img.width * sc) / 2; crop.y = (canvas.height - img.height * sc) / 2;
      $('photo-editor').hidden = false; $('photo-upload').disabled = true;
      drawCrop();
      $('photo-zoom').focus();
    } catch { showError('That image could not be opened. Try a JPEG or PNG photo.'); }
  });
  input.click();
});
$('photo-zoom').addEventListener('input', () => {
  if (!crop.img) return;
  // Zoom around the centre of the circle.
  const before = coverScale() * crop.zoom, cx = canvas.width / 2, cy = canvas.height / 2;
  const px = (cx - crop.x) / before, py = (cy - crop.y) / before;
  crop.zoom = Number($('photo-zoom').value) || 1;
  const after = coverScale() * crop.zoom;
  crop.x = cx - px * after; crop.y = cy - py * after;
  drawCrop();
});
canvas.addEventListener('pointerdown', e => {
  if (!crop.img) return;
  e.preventDefault();   // no text selection or page scroll while positioning the photo
  try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
  crop.drag = { x: e.clientX, y: e.clientY };
});
canvas.addEventListener('pointermove', e => {
  if (!crop.drag) return;
  const k = canvas.width / canvas.getBoundingClientRect().width;
  crop.x += (e.clientX - crop.drag.x) * k; crop.y += (e.clientY - crop.drag.y) * k;
  crop.drag = { x: e.clientX, y: e.clientY };
  drawCrop();
});
for (const ev of ['pointerup', 'pointercancel']) canvas.addEventListener(ev, () => { crop.drag = null; });
canvas.tabIndex = 0;
canvas.addEventListener('keydown', e => {
  const step = { ArrowLeft: [12, 0], ArrowRight: [-12, 0], ArrowUp: [0, 12], ArrowDown: [0, -12] }[e.key];
  if (!step || !crop.img) return;
  e.preventDefault(); crop.x += step[0]; crop.y += step[1]; drawCrop();
});
$('photo-cancel').addEventListener('click', closeEditor);
$('photo-save').addEventListener('click', async () => {
  if (!crop.img) return;
  const out = document.createElement('canvas'); out.width = out.height = 256;
  const o = out.getContext('2d'); o.imageSmoothingQuality = 'high';
  o.fillStyle = '#ffffff'; o.fillRect(0, 0, 256, 256);
  o.drawImage(canvas, 0, 0, 256, 256);
  let avatar = '';
  for (const q of [0.88, 0.75, 0.6]) { avatar = out.toDataURL('image/jpeg', q); if (avatar.length < 190 * 1024) break; }
  clearMessages();
  $('photo-save').disabled = true;
  try {
    await call('/api/account', { method: 'PATCH', body: { avatar } });
    closeEditor();
    showNotice('Photo saved.');
    tellShell();
    await loadAccount();
  } catch (err) { showError(err.message); }
  finally { $('photo-save').disabled = false; }
});
$('photo-remove').addEventListener('click', async () => {
  clearMessages();
  try { await call('/api/account', { method: 'PATCH', body: { avatar: null } }); showNotice('Photo removed.'); tellShell(); await loadAccount(); }
  catch (err) { showError(err.message); }
});


Promise.all([loadAccount(), loadSessions(), loadTokens()]).catch(err => { if (err.status !== 401) showError(err.message); });
