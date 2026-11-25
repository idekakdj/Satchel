// Writes the landing pages: the Satchel suite page (satchel/public/index.html) and one
// page per app (<app>/index.html), all from the same template so they stay alike.
// Run: node scripts/build-landings.cjs
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const icon = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const I = {
  calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/>',
  repeat: '<path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>',
  check: '<path d="M9 11l3 3 8-8"/><path d="M20 12v6a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3h9"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
  palette: '<circle cx="12" cy="12" r="9"/><circle cx="8" cy="10" r="1.2"/><circle cx="12" cy="7.5" r="1.2"/><circle cx="16" cy="10" r="1.2"/><path d="M12 21a3 3 0 0 1 0-6h2"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  pen: '<path d="M12 19l7-7 3 3-7 7z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18z"/><circle cx="11" cy="11" r="2"/>',
  type: '<path d="M4 7V4h16v3M9 20h6M12 4v16"/>',
  sync: '<path d="M21 12a9 9 0 0 1-15 6.7L3 16M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5M3 21v-5h5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  grid: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
  wallet: '<path d="M20 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h15v12H5a2 2 0 0 1-2-2V5"/><circle cx="16" cy="13" r="1.3"/>',
  pie: '<path d="M21 12A9 9 0 1 1 12 3v9z"/><path d="M15 3.5A9 9 0 0 1 20.5 9H15z"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  swap: '<path d="M7 7h13l-4-4M17 17H4l4 4"/>',
  upload: '<path d="M12 15V3M7 8l5-5 5 5"/><path d="M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"/>',
  dumbbell: '<path d="M6 7v10M18 7v10M3 10v4M21 10v4M6 12h12"/>',
  apple: '<path d="M12 7c-2-2-7-1.5-7 4 0 4 3 9 5 9 1 0 1.5-.5 2-.5s1 .5 2 .5c2 0 5-5 5-9 0-5.5-5-6-7-4z"/><path d="M12 7c0-2 1-4 3-4"/>',
  flame: '<path d="M12 22a7 7 0 0 0 7-7c0-5-4-6-4-11-3 2-5 5-5 8-1-1-2-2-2-4-2 2-3 4-3 7a7 7 0 0 0 7 7z"/>',
  chart: '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 6-6"/>',
  list: '<path d="M9 6h12M9 12h12M9 18h12"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3M15 8l2 2"/>',
  qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v1M14 20h1M18 18h3v3"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  wifi: '<path d="M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0"/><circle cx="12" cy="19.5" r="1"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
};

const APPS = [
  {
    key: 'almanac', name: 'Almanac', kind: 'Calendar & planner', short: 'Classes, deadlines and study sessions on one calendar.',
    title: 'Your semester, <em>a little more</em> in order.',
    lead: 'Almanac is a calendar built for student life. Semesters, courses, repeating classes, assignments, exams and study sessions all live on one month, week or agenda view, with a task list that keeps the next seven days in front of you.',
    sheet: { title: 'This week', rows: [['', 'CS 240 lecture', 'Mon 10:00'], ['b', 'Problem set 4 due', 'Wed 23:59'], ['c', 'Study session: linear algebra', 'Thu 14:00'], ['d', 'Midterm, MATH 136', 'Fri 09:30']] },
    features: [
      ['calendar', 'Month, week and agenda', 'Switch views in a tap. Drag to move or resize events, and expand any day to see its full schedule.'],
      ['repeat', 'Repeating classes, done right', 'Weekly timetables follow your semester dates and breaks. Change one class, or the whole series, and review the effect first.'],
      ['check', 'Tasks with progress', 'Assignments, exams and study sessions become tasks. Tick them off and watch your weekly progress grow.'],
      ['bell', 'Reminders', 'Set reminders per item. Almanac shows them as browser notifications and keeps missed ones in an inbox.'],
      ['file', 'Import and export', 'Bring in any .ics calendar, export to other apps, and keep full backups. Old C.C. Lime backups restore too.'],
      ['palette', 'Make it yours', 'Profile photo, preset or custom colour themes, and course colours that follow you everywhere.'],
    ],
    steps: [['Add your semester', 'Set the dates and breaks once.'], ['Add courses and classes', 'Classes repeat for the whole term automatically.'], ['Drop in deadlines', 'Assignments and exams turn into tasks with reminders.']],
  },
  {
    key: 'margin', name: 'Margin', kind: 'Notepad', short: 'Typed and handwritten notes, filed in folders.',
    title: 'Notes that write <em>like paper</em>.',
    lead: 'Margin keeps every lecture, reading and idea in tidy folders. Type with the keyboard, or pick up an Apple Pencil or any stylus and write straight onto the page, with pressure-sensitive ink and palm rejection.',
    sheet: { title: 'Folders', rows: [['e', 'Lectures / Organic chemistry', '12'], ['b', 'Readings', '7'], ['c', 'Lab reports', '4'], ['d', 'Ideas', '19']] },
    features: [
      ['folder', 'Folders in a sidebar', 'Nest folders as deep as you like in a sidebar that folds away when you need the whole page.'],
      ['pen', 'Pen-first handwriting', 'Apple Pencil and other styluses draw with pressure and tilt. Your palm and fingers scroll, they never scribble.'],
      ['type', 'Type, then annotate', 'Every note has a text layer and an ink layer on the same page, so you can type notes and mark them up.'],
      ['grid', 'Paper styles', 'Blank, lined, grid or dotted pages. Pen, pencil, highlighter and a stroke eraser.'],
      ['sync', 'Saved as you go', 'Notes save while you write and open on any device you sign in on.'],
      ['search', 'Find anything', 'Search titles and typed text across every folder.'],
    ],
    steps: [['Make a folder', 'One per course, project or anything else.'], ['Start a note', 'Choose the paper and start typing or writing.'], ['Pick it up anywhere', 'Your notes follow your account to every device.']],
  },
  {
    key: 'ledger', name: 'Ledger', kind: 'Finance tracker', short: 'Budgets, spending and savings goals.',
    title: 'Know where <em>your money</em> went.',
    lead: 'Ledger is a simple, private money tracker. Log spending and income in seconds, set monthly budgets per category, follow your account balances and save towards goals, without linking a bank.',
    sheet: { title: 'November', rows: [['d', 'Groceries', '$212.40'], ['c', 'Rent', '$850.00'], ['b', 'Textbooks', '$96.15'], ['e', 'Coffee', '$38.50']] },
    features: [
      ['wallet', 'Accounts and balances', 'Cash, chequing, savings and cards, each with a running balance. Transfers move money between them.'],
      ['pie', 'Budgets by category', 'Set a monthly budget for each category and see at a glance how much is left.'],
      ['chart', 'Clear reports', 'Spending by category and a month-by-month trend of income against spending.'],
      ['target', 'Savings goals', 'Save towards a trip, a laptop or an emergency fund and track the progress.'],
      ['repeat', 'Recurring entries', 'Rent, subscriptions and pay days can repeat weekly, every two weeks or monthly.'],
      ['upload', 'CSV in and out', 'Import a CSV from your bank, export everything whenever you like.'],
    ],
    steps: [['Add your accounts', 'Starting balances for cash, bank and cards.'], ['Log as you spend', 'Amount, category, done.'], ['Check the month', 'Budgets and reports show where it went.']],
  },
  {
    key: 'stride', name: 'Stride', kind: 'Fitness tracker', short: 'Workouts, meals and calorie estimates.',
    title: 'Train, eat, <em>repeat</em>.',
    lead: 'Stride tracks the two halves of fitness. Build your own workouts from your own exercises, log every set, and record meals from a bank of common foods that estimates calories and macros for you.',
    sheet: { title: 'Today', rows: [['c', 'Calories', '1,640 / 2,200'], ['d', 'Protein', '96 g'], ['b', 'Push day: 5 exercises', '52 min'], ['e', 'Water', '6 glasses']] },
    features: [
      ['dumbbell', 'Your own workouts', 'Create exercises with the measures you care about: reps, weight, time or distance. Group them into routines.'],
      ['list', 'Log every set', 'Start a routine and tick off sets as you go. Stride remembers what you lifted last time.'],
      ['apple', 'Common foods built in', 'Search hundreds of common foods with calories and macros per serving, or add your own.'],
      ['flame', 'Calorie estimates', 'Pick a food and a portion, and Stride estimates calories, protein, carbs and fat as you type.'],
      ['grid', 'Meals your way', 'Rename, add or remove meal sections, and save favourite meals to log again in one tap.'],
      ['chart', 'Progress over time', 'Daily totals against your goals, body weight trend and workouts per week.'],
    ],
    steps: [['Set your goals', 'Stride suggests a calorie target from your profile.'], ['Build a routine', 'Pick exercises and set targets.'], ['Log meals and sessions', 'Totals update as you go.']],
  },
  {
    key: 'tunnel', name: 'Tunnel', kind: 'VPN profiles', short: 'WireGuard VPN profiles for every device.',
    title: 'Safer Wi-Fi, <em>wherever</em> you study.',
    lead: 'Tunnel manages WireGuard VPN profiles. Generate keys in your browser, paste in a config from your VPN provider or your own server, and send each device its profile by QR code or file. The official WireGuard app does the tunnelling.',
    sheet: { title: 'Profiles', rows: [['b', 'Toronto, my VPS', 'iPad'], ['d', 'Frankfurt, provider', 'Laptop'], ['c', 'Home network', 'Phone']] },
    features: [
      ['key', 'Keys made on your device', 'Key pairs are generated in your browser with X25519. Private keys are stored only inside your encrypted Satchel account.'],
      ['qr', 'QR code for phones and iPads', 'Scan a profile straight into the WireGuard app on iOS or Android.'],
      ['file', 'Config files for computers', 'Download a ready .conf file for WireGuard on Windows, macOS or Linux.'],
      ['globe', 'Change your location', 'Keep a profile per server location, from your own VPS or a provider that offers WireGuard.'],
      ['wifi', 'Public Wi-Fi privacy', 'Route traffic through an encrypted tunnel on campus, café or hotel networks.'],
      ['shield', 'Setup checker', 'Tunnel checks every profile for missing keys, bad addresses and DNS leaks before you export it.'],
    ],
    steps: [['Get a server', 'Your own VPS, or a WireGuard-capable VPN provider.'], ['Make a profile', 'Generate keys or paste the provider config.'], ['Scan or download', 'Import into the WireGuard app and connect.']],
    note: 'Tunnel does not run a VPN server or route any traffic itself. A browser cannot start a system VPN, so connecting is done in the free WireGuard app.',
  },
];

function nav(app) {
  const brand = app
    ? `<a class="brand" href="/"><img src="/${app.key}/img/icon.svg" alt="" width="30" height="30">${esc(app.name)}<small>by Satchel</small></a>`
    : `<a class="brand" href="/"><img src="/img/satchel.svg" alt="" width="30" height="30">Satchel</a>`;
  const next = app ? `/${app.key}/app` : '/';
  const q = '?next=' + encodeURIComponent(next);
  return `<nav class="nav"><div class="wrap">${brand}<div class="nav-links">${app ? '<a class="hide-sm" href="#features">Features</a><a class="hide-sm" href="/">All apps</a>' : '<a class="hide-sm" href="#apps">Apps</a><a class="hide-sm" href="#how">How it works</a>'}<a href="/auth${q}">Sign in</a><a class="btn btn-primary btn-sm" href="/auth?mode=signup&amp;next=${encodeURIComponent(next)}">Get started</a></div></div></nav>`;
}
function footer() {
  return `<footer><div class="wrap"><span>© 2026 Satchel · Almanac · Margin · Ledger · Stride · Tunnel</span><span><a href="/privacy">Privacy</a><a href="/terms">Terms</a></span></div></footer>`;
}
function sheet(s) {
  return `<div class="art" aria-hidden="true"><div class="sheet back"></div><div class="sheet front"><h4>${esc(s.title)}</h4>${s.rows.map(([c, a, b]) => `<div class="row"><span class="chip ${c}"></span>${esc(a)}<span class="num">${esc(b)}</span></div>`).join('')}</div></div>`;
}
function page({ title, desc, bodyClass, icon: iconHref, content, app }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <script src="/js/frame-escape.js"></script>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="referrer" content="no-referrer">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(desc)}">
  <link rel="icon" href="${iconHref}" type="image/svg+xml">
  <link rel="stylesheet" href="/css/landing.css">
</head>
<body${bodyClass ? ` class="${bodyClass}"` : ''}>
${nav(app)}
<main>
${content}
</main>
${footer()}
</body>
</html>
`;
}

function appPage(app) {
  const next = encodeURIComponent(`/${app.key}/app`);
  const content = `<section class="hero"><div class="wrap"><div><span class="eyebrow">${esc(app.kind)}</span><h1>${app.title}</h1><p class="lead">${esc(app.lead)}</p><div class="cta"><a class="btn btn-accent" href="/auth?mode=signup&amp;next=${next}">Start using ${esc(app.name)}</a><a class="btn btn-ghost" href="/auth?next=${next}">I have an account</a></div><p class="cta-note">Free. One Satchel account opens all five apps.</p></div>${sheet(app.sheet)}</div></section>
<section class="section alt" id="features"><div class="wrap"><div class="sec-head"><h2>Everything ${esc(app.name)} does</h2><p>${esc(app.short)}</p></div><div class="grid">${app.features.map(([g, h, p]) => `<div class="card"><span class="glyph">${icon(I[g])}</span><h3>${esc(h)}</h3><p>${esc(p)}</p></div>`).join('')}</div>${app.note ? `<p class="note-box">${esc(app.note)}</p>` : ''}</div></section>
<section class="section" id="how"><div class="wrap"><div class="sec-head"><h2>Up and running in three steps</h2></div><div class="steps">${app.steps.map(([h, p]) => `<div class="step"><h3>${esc(h)}</h3><p>${esc(p)}</p></div>`).join('')}</div></div></section>
<section class="section"><div class="wrap"><div class="band"><div><h2>Open ${esc(app.name)}</h2><p>Sign in once and ${esc(app.name)} sits in a tab beside the rest of your Satchel.</p></div><a class="btn btn-accent" href="/auth?mode=signup&amp;next=${next}">Create your account</a></div></div></section>`;
  return page({ title: `${app.name} — ${app.kind} · Satchel`, desc: `${app.name}: ${app.short}`, bodyClass: `app-${app.key}`, icon: `/${app.key}/img/icon.svg`, content, app });
}

function suitePage() {
  const content = `<section class="hero"><div class="wrap"><div><span class="eyebrow">Your study companion</span><h1>Everything you carry, <em>in one satchel</em>.</h1><p class="lead">Satchel packs a calendar, a notepad, a money tracker, a fitness log and a VPN manager behind one sign-in. Each app opens in its own tab, and your home dashboard pulls the day together.</p><div class="cta"><a class="btn btn-accent" href="/auth?mode=signup&amp;next=%2F">Create a free account</a><a class="btn btn-ghost" href="/auth">Sign in</a></div><p class="cta-note">No ads, no tracking. Your data stays in your account.</p></div>${sheet({ title: 'Today', rows: [['', 'Almanac: Calculus lecture', '10:00'], ['e', 'Margin: Lecture 14 notes', 'Edited'], ['d', 'Ledger: Spent this month', '$642'], ['c', 'Stride: Calories', '1,640'], ['b', 'Tunnel: Toronto profile', 'Ready']] })}</div></section>
<section class="section alt" id="apps"><div class="wrap"><div class="sec-head"><h2>Five apps, one bag</h2><p>Each one stands on its own. Together they cover your week.</p></div><div class="rack">${APPS.map(a => `<a class="app-card" href="/${a.key}"><img src="/${a.key}/img/icon.svg" alt="" width="52" height="52"><span><h3>${esc(a.name)}</h3><p>${esc(a.short)}</p><span class="kind">${esc(a.kind)}</span></span></a>`).join('')}</div></div></section>
<section class="section" id="how"><div class="wrap"><div class="sec-head"><h2>How Satchel works</h2><p>A home base for your apps, built like a browser.</p></div><div class="grid"><div class="card"><span class="glyph">${icon(I.lock)}</span><h3>One sign-in</h3><p>One account, protected by strong password hashing and optional two-step sign-in, opens every app.</p></div><div class="card"><span class="glyph">${icon(I.grid)}</span><h3>A dashboard and tabs</h3><p>Your home page shows what's next from every app. Open apps side by side in tabs and switch with a swipe.</p></div><div class="card"><span class="glyph">${icon(I.sync)}</span><h3>On every device</h3><p>Use it on a laptop or an iPad. Your data is saved to your account and is the same wherever you sign in.</p></div></div></div></section>
<section class="section"><div class="wrap"><div class="band"><div><h2>Pack your satchel</h2><p>It takes a minute to set up, and it's free.</p></div><a class="btn btn-accent" href="/auth?mode=signup&amp;next=%2F">Get started</a></div></div></section>`;
  return page({ title: 'Satchel — your calendar, notes, money, fitness and VPN in one place', desc: 'Satchel: Almanac, Margin, Ledger, Stride and Tunnel behind one sign-in.', bodyClass: '', icon: '/img/satchel.svg', content, app: null });
}

for (const app of APPS) fs.writeFileSync(path.join(ROOT, app.key, 'index.html'), appPage(app));
fs.writeFileSync(path.join(ROOT, 'satchel', 'public', 'index.html'), suitePage());
console.log('Wrote', APPS.length + 1, 'landing pages.');
module.exports = { APPS };
