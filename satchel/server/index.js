// Satchel - one channel for every app. Express server entry point.
if (require.main === module) {
  console.error('Use npm start (server/start.cjs) to share the browser/desktop runtime safely.');
  process.exit(1);
}
// Hosts the Satchel shell plus Almanac, Margin, Ledger, Stride and Tunnel behind
// a single shared sign-in.
const path = require('path');
const fs = require('fs');
const express = require('express');
const helmet = require('helmet');
const {
  apiLimiter, writeLimiter, pageLimiter, csrfProtect, requireAuth, getSessionUser, safeNextPath, mfaSetupPending,
} = require('./security');
const mfa = require('./mfa');
const authRoutes = require('./auth');
const accountRoutes = require('./account');
const almanac = require('./almanac');
const noteRoutes = require('./notes');
const appdocRoutes = require('./appdocs');
const dashboardRoutes = require('./dashboard');
const { tokenAuth, rejectToken } = require('./tokens');

const app = express();
const ASSET_ROOT = process.env.SATCHEL_ASSET_ROOT || path.join(__dirname, '..', '..');
const SATCHEL_PUBLIC = path.join(ASSET_ROOT, 'satchel', 'public');
// The five apps, each in its own folder beside satchel/: index.html (landing page for
// signed-out visitors), app.html (the signed-in app), css/ js/ img/ data/.
const APPS = ['almanac', 'margin', 'ledger', 'stride', 'tunnel'];
const APP_DIR = Object.fromEntries(APPS.map(a => [a, path.join(ASSET_ROOT, a)]));

app.disable('x-powered-by');
// Hosted mode is reached only through a reverse proxy on this machine.
if (process.env.SATCHEL_LOCAL_ONLY === '0') app.set('trust proxy', 'loopback');

// ---------- security headers ----------
// One strict Content-Security-Policy for every app: scripts, styles, fonts and
// images come from this origin only (Placeholder's libraries and fonts are
// self-hosted under placeholder/vendor). Everything else from helmet applies globally.
const baseHelmet = helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  // The tab shell (home.html) embeds app pages in same-origin iframes, so framing is
  // limited to this origin (X-Frame-Options SAMEORIGIN plus CSP frame-ancestors 'self')
  // instead of denied outright. Other sites still cannot frame Satchel.
  xFrameOptions: { action: 'sameorigin' },
});

const strictCsp = helmet.contentSecurityPolicy({
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    // No 'unsafe-inline': pages and apps use stylesheets and classes; scripts set only
    // individual CSSOM properties (el.style.x = ...), which CSP allows.
    styleSrc: ["'self'"],
    imgSrc: ["'self'", 'data:', 'blob:'],
    mediaSrc: ["'self'", 'blob:'],           // video/audio decoding for conversions
    connectSrc: ["'self'"],
    fontSrc: ["'self'"],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
    frameAncestors: ["'self'"],   // same-origin only: the tab shell frames app pages (see baseHelmet)
  },
});

app.use(baseHelmet);
app.use((req, res, next) => {
  // None of the apps need device APIs; deny them so injected code could not use them either.
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), accelerometer=(), gyroscope=(), magnetometer=(), interest-cohort=()');
  next();
});
app.use((req, res, next) => {
  strictCsp(req, res, next);
});

// Liveness probe for monitoring: reveals nothing about the system.
app.get('/healthz', (req, res) => { res.set('Cache-Control', 'no-store'); res.json({ ok: true }); });

// ---------- shared API: rate limited + CSRF checked ----------
// Every limit and the CSRF check run before a body is read. Data routes also require a
// signed-in session (or a personal access token, see tokens.js) BEFORE the body parser,
// so anonymous clients cannot make the server buffer large payloads. Each route gets a
// body limit matching its real maximum. Token requests pass the same rate limiters.
app.use('/api', apiLimiter, writeLimiter, tokenAuth, csrfProtect, (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
const json = limit => express.json({ limit });
app.use('/api/auth', json('16kb'), authRoutes);
// 300kb: a profile photo (a 256 px JPEG, under 200 KB) is saved through PATCH /api/account.
app.use('/api/account', rejectToken, requireAuth, json('300kb'), accountRoutes);
app.use('/api/almanac', requireAuth, json('55mb'), almanac.router);
app.use('/api/notes', requireAuth, json('9mb'), noteRoutes);
app.use('/api/apps', requireAuth, json('6mb'), appdocRoutes);
app.use('/api/dashboard', requireAuth, dashboardRoutes);

// ---------- page helpers ----------
// Pages (not the API) share one generous limiter to blunt scraping and request floods.
app.use((req, res, next) => (req.path.startsWith('/api/') ? next() : pageLimiter(req, res, next)));

function gate(req, res, file, dir) {
  const user = getSessionUser(req);
  if (!user) {
    return res.redirect('/auth?next=' + encodeURIComponent(safeNextPath(req.originalUrl)));
  }
  // SATCHEL_REQUIRE_MFA=1: until two-step sign-in is set up, only the account page opens.
  if (file !== 'account.html' && mfaSetupPending(req, user)) return res.redirect('/account?setup-mfa=1');
  // Signed-in pages must never be kept by a shared browser's cache.
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(dir, file));
}

// Signed-in people never see landing pages: "/" is the tab shell (home.html) for them.
// Falls back to the landing page only if the shell file is missing from the install.
function home(req, res) {
  const user = getSessionUser(req);
  if (!user) return res.sendFile(path.join(SATCHEL_PUBLIC, 'index.html'));
  if (mfaSetupPending(req, user)) return res.redirect('/account?setup-mfa=1');
  res.set('Cache-Control', 'no-store');
  const shell = path.join(SATCHEL_PUBLIC, 'home.html');
  res.sendFile(fs.existsSync(shell) ? shell : path.join(SATCHEL_PUBLIC, 'index.html'));
}
// An app's landing page is for signed-out visitors; signed-in people are sent to the shell.
function landing(dir) {
  return (req, res) => {
    if (getSessionUser(req)) return res.redirect('/');
    res.sendFile(path.join(dir, 'index.html'));
  };
}

// Static files are served from an allow-list: only web asset types, never tests,
// reports, scripts (.cjs), source notes (.md) or anything under a tests/ folder. An
// application directory also contains developer files that must not be public.
const PUBLIC_EXT = new Set(['.html', '.js', '.mjs', '.css', '.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.woff', '.woff2', '.json']);
function assets(dir, options = {}) {
  const serve = express.static(dir, { index: options.index === true ? 'index.html' : false, dotfiles: 'deny', fallthrough: true });
  return (req, res, next) => {
    let p;
    try { p = decodeURIComponent(req.path); } catch { return res.status(400).end(); }
    if (/(^|[\\/])(tests?|node_modules|\.[^\\/]*)([\\/]|$)/i.test(p) || p.includes('\0')) return next();
    const ext = path.extname(p).toLowerCase();
    if (ext && !PUBLIC_EXT.has(ext)) return next();
    serve(req, res, next);
  };
}

// ---------- Satchel shell ----------
app.get('/', home);
app.get('/home.html', (req, res) => (getSessionUser(req) ? home(req, res) : res.redirect('/')));
app.get('/auth', (req, res) => {
  // During a two-step challenge the person may still hold an older session; keep the page open for the code.
  const challenged = req.query.mfa === '1' && mfa.hasChallengeCookie(req);
  if (!challenged && getSessionUser(req)) return res.redirect(safeNextPath(req.query.next));
  res.sendFile(path.join(SATCHEL_PUBLIC, 'auth.html'));
});
app.get('/privacy', (req, res) => res.sendFile(path.join(SATCHEL_PUBLIC, 'privacy.html')));
app.get('/terms', (req, res) => res.sendFile(path.join(SATCHEL_PUBLIC, 'terms.html')));
app.get('/reset', (req, res) => res.sendFile(path.join(SATCHEL_PUBLIC, 'reset.html')));
app.get('/account', (req, res) => gate(req, res, 'account.html', SATCHEL_PUBLIC));

// ---------- apps ----------
for (const name of APPS) {
  const dir = APP_DIR[name];
  app.get(['/' + name, '/' + name + '/', '/' + name + '/index.html'], landing(dir));
}
// Almanac is a built React app (almanac/app/, made by npm run build in almanac/).
app.get(['/almanac/app', '/almanac/app/', '/almanac/app/index.html'], (req, res) => {
  if (req.path === '/almanac/app') return res.redirect(301, '/almanac/app/');
  gate(req, res, 'index.html', path.join(APP_DIR.almanac, 'app'));
});
app.use('/almanac/app/assets', assets(path.join(APP_DIR.almanac, 'app', 'assets')));
for (const name of ['margin', 'ledger', 'stride', 'tunnel']) {
  app.get(['/' + name + '/app', '/' + name + '/app.html'], (req, res) => gate(req, res, 'app.html', APP_DIR[name]));
}
// Only the public folders of each app are served (never src/, server/ or node_modules/).
for (const name of APPS) {
  for (const sub of ['css', 'js', 'img', 'data']) app.use('/' + name + '/' + sub, assets(path.join(APP_DIR[name], sub)));
}

// Satchel shell assets (css/js/img for the landing + auth pages). The gated account
// page is also reachable by file name, so it is excluded here and served via gate().
app.use((req, res, next) => (/^\/account\.html$/i.test(req.path) ? res.redirect('/account') : next()));
app.use(assets(SATCHEL_PUBLIC));

// JSON 404 for unknown API routes, page 404 otherwise.
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.status(404).sendFile(path.join(SATCHEL_PUBLIC, '404.html'));
});

// Never leak stack traces. Client errors keep their 4xx status; everything else is a generic 500.
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error('[error]', req.method, req.path, err && err.message);
  if (res.headersSent) return res.destroy();
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Payload too large.' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body.' });
  const status = Number.isInteger(err.status) && err.status >= 400 && err.status < 500 ? err.status : 500;
  res.status(status).json({ error: status === 500 ? 'Something went wrong.' : 'Invalid request.' });
});

module.exports = app;
