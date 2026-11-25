// Replaces the Electron preload bridge: window.lime.call() goes to the Satchel
// server over fetch. File pickers, downloads, photo cropping and notifications
// happen here in the browser, so the React app stays unchanged.
import type { LimeApi } from '../shared/model';
import { avatarCropRectangle, type AvatarCrop } from '../shared/avatar-crop';

const ENDPOINT = '/api/almanac/rpc';
const changeListeners = new Set<() => void>();
const navigateListeners = new Set<(target: { itemId?: string; occurrenceKey?: string; action?: string }) => void>();
let notificationsWanted = false;

async function rpc<T>(command: string, payload?: unknown): Promise<T> {
  const res = await fetch(ENDPOINT, {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'satchel' },
    body: JSON.stringify({ command, payload: payload ?? null }),
  });
  let data: any = null; try { data = await res.json(); } catch { /* not JSON */ }
  if (res.status === 401) { window.top!.location.href = '/auth?next=' + encodeURIComponent('/almanac/app'); throw new Error('Your session ended. Sign in again.'); }
  if (!res.ok || !data || data.ok !== true) throw new Error(data?.error || `Request failed (${res.status})`);
  return data.result as T;
}

function pickFile(accept: string): Promise<File | null> {
  return new Promise(resolve => {
    const input = document.createElement('input'); input.type = 'file'; input.accept = accept; input.hidden = true;
    let done = false; const finish = (file: File | null) => { if (done) return; done = true; input.remove(); resolve(file); };
    input.addEventListener('change', () => finish(input.files?.[0] ?? null));
    input.addEventListener('cancel', () => finish(null));
    document.body.appendChild(input); input.click();
  });
}
function download(filename: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a'); a.href = url; a.download = filename; a.hidden = true; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
}

// ---------- profile photo (cropped in the browser) ----------
let photo: { token: string; image: HTMLCanvasElement; width: number; height: number } | null = null;
async function choosePhoto() {
  const file = await pickFile('image/png,image/jpeg');
  if (!file) return null;
  if (file.size > 5 * 1024 * 1024 || !/^image\/(png|jpeg)$/.test(file.type)) throw new Error('Choose a PNG or JPEG photo no larger than 5 MiB.');
  const bitmap = await createImageBitmap(file).catch(() => { throw new Error('This photo could not be opened. Choose another PNG or JPEG.'); });
  if (bitmap.width > 4096 || bitmap.height > 4096) throw new Error('Choose a photo up to 4,096 pixels wide and high.');
  const full = document.createElement('canvas'); full.width = bitmap.width; full.height = bitmap.height; full.getContext('2d')!.drawImage(bitmap, 0, 0);
  const scale = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height));
  const small = document.createElement('canvas'); small.width = Math.max(1, Math.round(bitmap.width * scale)); small.height = Math.max(1, Math.round(bitmap.height * scale));
  small.getContext('2d')!.drawImage(bitmap, 0, 0, small.width, small.height);
  photo = { token: crypto.randomUUID(), image: full, width: bitmap.width, height: bitmap.height };
  return { token: photo.token, preview: small.toDataURL('image/png'), width: bitmap.width, height: bitmap.height };
}
function renderPhoto(adjustment: AvatarCrop): string {
  if (!photo) throw new Error('This photo preview expired. Please choose the photo again.');
  const r = avatarCropRectangle(photo.width, photo.height, adjustment);
  const out = document.createElement('canvas'); out.width = 128; out.height = 128;
  const ctx = out.getContext('2d')!; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(photo.image, r.x, r.y, r.width, r.height, 0, 0, 128, 128);
  return out.toDataURL('image/png');
}

// ---------- reminders as browser notifications ----------
function showNotices(notices: Array<{ title: string; body: string; itemId?: string; occurrenceKey?: string; inbox?: boolean }> | undefined) {
  if (!notices?.length) return;
  const canShow = 'Notification' in window && Notification.permission === 'granted';
  for (const n of notices) {
    if (!canShow) continue;
    try {
      const shown = new Notification(n.title, { body: n.body, icon: '/almanac/img/icon.svg', tag: n.itemId || undefined });
      shown.onclick = () => { window.focus(); window.SatchelTabs?.open?.('/almanac/app'); for (const l of navigateListeners) l(n.inbox ? { action: 'inbox' } : { itemId: n.itemId, occurrenceKey: n.occurrenceKey }); shown.close(); };
    } catch { /* some browsers only allow notifications from a service worker */ }
  }
}
async function askPermission() {
  if (!('Notification' in window) || Notification.permission !== 'default') return;
  try { await Notification.requestPermission(); } catch { /* ignored */ }
}

async function call<T>(command: string, payload?: unknown): Promise<T> {
  switch (command) {
    case 'snapshot': {
      const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const result: any = await rpc('snapshot', { ...(payload as object ?? {}), zone });
      notificationsWanted = !!result?.device?.notifications;
      showNotices(result?.notices); delete result.notices;
      return result as T;
    }
    case 'device': {
      if ((payload as any)?.notifications === true) await askPermission();
      return rpc<T>(command, payload);
    }
    case 'testNotification': await askPermission(); return rpc<T>(command, payload);
    case 'import.preview': {
      const file = await pickFile('.ics,text/calendar'); if (!file) return null as T;
      if (file.size > 10 * 1024 * 1024) throw new Error('Choose a calendar file no larger than 10 MB.');
      return rpc<T>(command, { ...(payload as object), text: await file.text(), filename: file.name });
    }
    case 'restore.preview': {
      const file = await pickFile('.json,application/json'); if (!file) return null as T;
      if (file.size > 50 * 1024 * 1024) throw new Error('Choose a backup no larger than 50 MB.');
      return rpc<T>(command, { text: await file.text(), filename: file.name });
    }
    case 'export': case 'backup': {
      const r = await rpc<{ filename: string; text: string; type: string }>(command, payload);
      download(r.filename, r.text, r.type); return r.filename as T;
    }
    case 'profile.photo': return await choosePhoto() as T;
    case 'profile.photo.save': {
      const p = payload as { token: string; adjustment: AvatarCrop };
      if (!photo || photo.token !== p.token) throw new Error('This photo preview expired. Please choose the photo again.');
      const avatar = renderPhoto(p.adjustment); photo = null; return rpc<T>('profile.avatar', { avatar });
    }
    case 'profile.photo.cancel': photo = null; return true as T;
    case 'auth.signOut': await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin', headers: { 'X-Requested-With': 'satchel' } }); window.top!.location.href = '/'; return true as T;
    case 'auth.cancel': case 'auth.totp.cancel': case 'auth.refresh': return true as T;
    default: return rpc<T>(command, payload);
  }
}

// Poll for reminders and for changes made in another tab or device.
function tick() { if (document.visibilityState === 'visible' || notificationsWanted) for (const l of changeListeners) l(); }
setInterval(tick, 20000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') tick(); });

const api: LimeApi = {
  call,
  onChange(callback) { changeListeners.add(callback); return () => changeListeners.delete(callback); },
  onNavigate(callback) { navigateListeners.add(callback); return () => navigateListeners.delete(callback); },
};
window.lime = api;
declare global { interface Window { SatchelTabs?: { open?: (path: string) => void } } }
