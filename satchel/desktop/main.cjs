const { app, BrowserWindow, Menu, Tray, dialog, shell, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { startRuntime } = require('./runtime.cjs');
const { loadEnvFile } = require('../server/env-file');

// Google sign-in keys for the desktop app live in a .env file in the Satchel user folder
// (%APPDATA%\Satchel\.env), never in the installer. Template written by the
// "Set up Google sign-in" menu item.
const ENV_TEMPLATE = [
  '# Satchel desktop settings. Keep this file private: it holds secrets.',
  '# Google sign-in: Google Cloud Console > APIs & Services > Credentials > OAuth client ID (Web application),',
  '# with this Authorized redirect URI:  http://127.0.0.1:4320/api/auth/google/callback',
  '# Paste the values after the = signs, save, then quit and reopen Satchel.',
  'GOOGLE_CLIENT_ID=',
  'GOOGLE_CLIENT_SECRET=',
  '',
].join('\r\n');

const TEST_DIR = process.env.SATCHEL_DESKTOP_TEST_DIR;
// Started by Windows at sign-in ("Start with Windows"): stay in the tray so Almanac reminders run.
const startHidden = process.argv.includes('--hidden');

app.setName('Satchel');
// Windows only shows notifications (Almanac reminders) for an app with this ID; the installer's
// shortcuts carry the same one.
app.setAppUserModelId('com.satchel.desktop');
// Test launches never touch the normal desktop profile or database.
if (TEST_DIR) {
  fs.mkdirSync(TEST_DIR, { recursive: true });
  app.setPath('userData', path.resolve(TEST_DIR));
}
// Defence in depth: no window of this app may ever embed a <webview>.
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', event => event.preventDefault());
});
const hasLock = app.requestSingleInstanceLock();
let window, runtime, tray;
let quitting = false;          // true once a real quit starts; until then closing the window only hides it
function showWindow() {
  if (!window) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}
// Satchel lives in the Windows notification area (system tray): closing the window hides it
// there, so open tabs keep running and Almanac can still remind you; "Quit Satchel" really exits.
function createTray() {
  tray = new Tray(path.join(__dirname, 'icon.ico'));
  tray.setToolTip('Satchel');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Satchel', click: showWindow },
    { type: 'separator' },
    { label: 'Quit Satchel', click: () => app.quit() },
  ]));
  tray.on('click', showWindow);
  tray.on('double-click', showWindow);
}
// The first time the window is closed to the tray, say so once (remembered per profile).
function trayNoticeOnce() {
  const flag = path.join(app.getPath('userData'), 'tray-notice-shown');
  if (fs.existsSync(flag)) return;
  try { fs.writeFileSync(flag, new Date().toISOString()); } catch { /* best effort */ }
  if (tray && process.platform === 'win32') {
    tray.displayBalloon({ iconType: 'info', title: 'Satchel is still running',
      content: 'Satchel keeps running in the system tray, so reminders still arrive. Click the icon to open it, or right-click it and choose Quit Satchel.' });
  }
}
const startsWithWindows = () => app.getLoginItemSettings({ args: ['--hidden'] }).openAtLogin;
function setStartWithWindows(on) {
  app.setLoginItemSettings({ openAtLogin: on, args: ['--hidden'] });
}

if (!hasLock) app.quit();
else {
  app.on('second-instance', showWindow);
  app.on('before-quit', () => { quitting = true; });
  app.whenReady().then(async () => {
    const dataDir = path.join(app.getPath('userData'), 'data');
    const assetRoot = app.isPackaged ? path.join(process.resourcesPath, 'workspace') : path.resolve(__dirname, '../..');
    const envFile = path.join(app.getPath('userData'), '.env');
    loadEnvFile(envFile);
    // Running from a source checkout (npm run desktop) also picks up satchel/.env; test
    // launches never do, so they cannot see the developer's real keys.
    if (!app.isPackaged && !TEST_DIR) loadEnvFile();
    runtime = await startRuntime({ dataDir, assetRoot });
    const isLocal = value => { try { return new URL(value).origin === runtime.origin; } catch { return false; } };

    // Only Satchel's own pages may show notifications (Almanac reminders) and copy text
    // (Tunnel's Copy buttons). Camera, microphone, location and everything else stay denied.
    const ALLOWED = new Set(['notifications', 'clipboard-sanitized-write']);
    const desktopSession = session.fromPartition('persist:satchel');
    desktopSession.setPermissionRequestHandler((contents, permission, callback, details) => {
      callback(ALLOWED.has(permission) && isLocal(details.requestingUrl || contents.getURL()));
    });
    desktopSession.setPermissionCheckHandler((_contents, permission, origin) => ALLOWED.has(permission) && isLocal(origin));

    window = new BrowserWindow({
      title: 'Satchel', width: 1440, height: 960, minWidth: 980, minHeight: 680,
      backgroundColor: '#f6f0e6', show: false, autoHideMenuBar: false,
      icon: path.join(__dirname, 'icon.ico'),
      webPreferences: {
        session: desktopSession, nodeIntegration: false, contextIsolation: true,
        sandbox: true, webSecurity: true, allowRunningInsecureContent: false,
        webviewTag: false, spellcheck: true,
      },
    });
    const navigate = url => window.loadURL(url).catch(err => {
      // A user choosing Stay in the unsaved-work dialog aborts navigation.
      if (err.code !== 'ERR_ABORTED') console.error('[desktop] navigation failed:', err.message);
    });
    // Google does not allow sign-in inside an app window, so "Continue with Google" runs in
    // the person's normal web browser and this window waits for the result (see the
    // desktop handoff in server/google.js). Test launches record the URL instead of opening it.
    const openInBrowser = url => {
      if (TEST_DIR) {
        fs.appendFileSync(path.join(TEST_DIR, 'opened-urls.txt'), url + '\n');
        return Promise.resolve();
      }
      return shell.openExternal(url);
    };
    async function googleSignIn(url) {
      const link = new URL(url);
      if (link.searchParams.has('handoff')) {
        // "Open the browser again". Cancelling the click's navigation also cancels the waiting
        // page's scheduled refresh, so reload it to keep checking.
        await openInBrowser(link.href);
        window.webContents.reload();
        return;
      }
      const id = crypto.randomBytes(32).toString('base64url');
      const secret = crypto.randomBytes(32).toString('base64url');                  // never leaves this app and the server
      const begin = new URL('/api/auth/google/desktop/begin', runtime.origin);
      for (const key of ['next', 'intent']) if (link.searchParams.has(key)) begin.searchParams.set(key, link.searchParams.get(key));
      begin.searchParams.set('id', id);
      begin.searchParams.set('secret', secret);
      await navigate(begin.href);
      // Only once the server has registered the sign-in (the window shows the waiting page).
      if (window && new URL(window.webContents.getURL()).pathname === '/api/auth/google/desktop/wait') {
        await openInBrowser(new URL('/api/auth/google/start?handoff=' + id, runtime.origin).href);
      }
    }
    // While the person is in their browser this window is in the background, where page
    // timers (the waiting page's auto-refresh) are throttled: check again the moment they return.
    window.on('focus', () => {
      try {
        if (new URL(window.webContents.getURL()).pathname === '/api/auth/google/desktop/wait') window.webContents.reload();
      } catch { /* no page yet */ }
    });
    window.webContents.on('will-navigate', (event, url) => {
      let target;
      try { target = new URL(url); } catch { event.preventDefault(); return; }
      if (target.origin === runtime.origin && target.pathname === '/api/auth/google/start') {
        event.preventDefault();
        googleSignIn(url).catch(err => dialog.showErrorBox('Google sign-in', err.message));
        return;
      }
      if (!isLocal(url)) event.preventDefault();
    });
    window.webContents.on('will-redirect', (event, url) => { if (!isLocal(url)) event.preventDefault(); });
    window.webContents.setWindowOpenHandler(({ url }) => {
      // Local target=_blank links stay inside the signed-in shell.
      if (isLocal(url)) void navigate(url);
      return { action: 'deny' };
    });
    window.webContents.on('will-prevent-unload', event => {
      const choice = dialog.showMessageBoxSync(window, {
        type: 'warning', title: 'Unsaved changes',
        message: 'Some of your changes have not been saved yet.',
        detail: 'Stay to let Satchel finish saving, or leave and discard the unsaved changes.',
        buttons: ['Stay', 'Discard changes'], defaultId: 0, cancelId: 0,
      });
      if (choice === 1) event.preventDefault();
      else quitting = false;      // "Stay" cancels a quit: closing the window hides it to the tray again
    });
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: 'Satchel', submenu: [
        { label: 'Satchel home', accelerator: 'CmdOrCtrl+Shift+H', click: () => navigate(runtime.origin) },
        { label: 'Open in web browser', click: () => openInBrowser(runtime.origin) },
        { type: 'separator' },
        { label: 'Start with Windows', type: 'checkbox', checked: !TEST_DIR && startsWithWindows(),
          click: item => { if (!TEST_DIR) setStartWithWindows(item.checked); } },
        { label: 'Open data folder', click: () => { fs.mkdirSync(dataDir, { recursive: true }); void shell.openPath(dataDir); } },
        { label: 'Set up Google sign-in…', click: async () => {
          const choice = await dialog.showMessageBox(window, {
            title: 'Set up Google sign-in', message: 'Add your Google sign-in keys',
            detail: 'Satchel opens its private settings file:\n' + envFile + '\n\nPaste your Google OAuth client ID and secret after the = signs, save the file, then quit and reopen Satchel. The file stays on this PC; it is never part of the installer or any upload.',
            buttons: ['Cancel', 'Open settings file'], defaultId: 1, cancelId: 0,
          });
          if (choice.response !== 1) return;
          if (!fs.existsSync(envFile)) fs.writeFileSync(envFile, ENV_TEMPLATE, { mode: 0o600 });
          const failed = await shell.openPath(envFile);
          if (failed) void shell.showItemInFolder(envFile);
        } },
        { type: 'separator' }, { label: 'Quit Satchel', accelerator: 'CmdOrCtrl+Q', click: () => app.quit() },
      ] },
      { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
      { label: 'View', submenu: [{ role: 'reload' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] },
      { label: 'Help', submenu: [{ label: 'About Satchel', click: () => dialog.showMessageBox(window, {
        title: 'Satchel', message: 'Satchel ' + app.getVersion(),
        detail: 'Almanac • Margin • Ledger • Stride • Tunnel\nYour accounts and data are stored on this PC in ' + dataDir + '.\nWhile Satchel is open you can also use it in a web browser at ' + runtime.origin + '.',
      }) }] },
    ]));
    window.once('ready-to-show', () => { if (!TEST_DIR && !startHidden) window.show(); });
    createTray();
    window.on('close', event => {
      if (quitting) return;
      event.preventDefault();
      window.hide();
      trayNoticeOnce();
    });
    window.on('closed', () => { window = null; });
    await window.loadURL(runtime.origin);
  }).catch(err => {
    dialog.showErrorBox('Satchel could not start', err.message + '\nYour existing data has not been replaced.');
    app.quit();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', event => {
    if (tray) { tray.destroy(); tray = null; }
    if (!runtime) return;
    event.preventDefault();
    const closing = runtime; runtime = null;
    closing.close().finally(() => app.exit(0));
  });
}
