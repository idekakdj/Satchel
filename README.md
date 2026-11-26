# Satchel

Satchel is a personal and study suite built on the Toolkit shell. Five apps sit behind one sign-in. Signed-out visitors see a landing page for the suite and one for each app. Signed-in people skip the landing pages and get a dashboard with browser-style tabs.

```
satchel/   the shell: Express server, shared sign-in, accounts, dashboard and tabs, landing pages
almanac/   Almanac: calendar and planner (the C.C. Lime calendar, ported to the web)
margin/    Margin: notepad with folders and pen handwriting
ledger/    Ledger: finance tracker
stride/    Stride: workouts, meals and a bank of common foods for calorie estimates
tunnel/    Tunnel: WireGuard VPN profile manager
```

## Run it

You need Node.js 22 or newer (Almanac's build was tested with Node 24).

```
cd satchel
npm install
npm run build
npm start
```

`npm run build` installs Almanac's packages, builds Almanac and regenerates the landing pages. Run it again after changing anything in `almanac/src`.

Then open http://127.0.0.1:4320. Data is stored in `%APPDATA%/Satchel/data/db.json` on Windows, or in `SATCHEL_DATA_DIR` if you set it. Set `SATCHEL_DATA_KEY` to encrypt that file. This matters here because Tunnel keeps WireGuard private keys in it. See `satchel/.env.example` for every setting, including Google sign-in and email.

### Windows desktop app

`npm run build:desktop` (after `npm run build`) makes `dist/Satchel-Setup-<version>-x64.exe`: a desktop app that runs Satchel in its own window and keeps it in the system tray, so Almanac reminders still arrive when the window is closed. It uses the same data folder as `npm start`. See `satchel/desktop/README.md`.

To use Satchel on an iPad, it has to be reachable from the iPad: either host it (see the hosted mode in `satchel/server/hosted.cjs`) or open it from your PC's address on the same network.

| URL | What |
|---|---|
| `/` | Suite landing page (signed out), or the dashboard and tabs (signed in) |
| `/auth`, `/account` | Shared sign-in, and Satchel's Settings page (opened inside the shell from the account menu or Almanac's avatar) |
| `/almanac`, `/margin`, `/ledger`, `/stride`, `/tunnel` | App landing pages (signed out only) |
| `/almanac/app/`, `/margin/app`, `/ledger/app`, `/stride/app`, `/tunnel/app` | The apps, which always open inside a dashboard tab |

## Settings

Settings belong to the whole suite, not to any one app. Open them from the account menu at the bottom of the sidebar, or from the avatar at the top right of Almanac. The page covers:
- **Profile.** Your name and photo. The photo is cropped in the browser and shows in the sidebar and in Almanac.
- **Time zone.** One zone for every app: Almanac's calendar and reminders, Stride's "today" and plans, and the dashboard. A new account starts with the device's zone, and changes reach open apps immediately.
- **Security and data.** Password, two-step sign-in, signed-in devices, data export, sign out and account deletion.

## The apps

**Almanac** keeps most of C.C. Lime:
- Semesters, courses, repeating classes, assignments, exams and study sessions.
- Month, week and agenda views, with drag to move and resize.
- Tasks with progress, a reminder inbox, and themes.
- `.ics` import and export, and full backups. C.C. Lime backups restore into Almanac.

It reuses C.C. Lime's React interface and domain code unchanged. `almanac/src/renderer/web-bridge.ts` replaces the Electron bridge, and `almanac/src/server/` replaces SQLite and Firebase with the Satchel store. Sign-in, MFA and account deletion are handled by Satchel. Reminders appear as browser notifications while an Almanac tab is open; missed ones wait in the inbox. There is no push to closed tabs.

**Margin** keeps notes in nested folders in a collapsible left sidebar. Every note is a sheet of paper (lined, grid, dotted or blank) with a typed text layer and a handwriting layer:
- **Pen input.** Apple Pencil and other styluses draw with pressure, and the pencil tool shades with tilt. Margin reads the extra in-between points the browser reports for smooth lines, and uses predicted points to cut lag.
- **Palm rejection.** Once a pen touches the page, fingers only scroll and pinch-zoom.
- **Editing tools.** Pen, pencil, highlighter, stroke eraser, undo and redo.
- **Typing.** In Type mode, iPad Scribble converts Pencil handwriting into text.
- **Search, export and sync.** You can search all your text and download a note as an image or a text file. Notes save as you write and open on any device you sign in on.

**Ledger** covers personal finance:
- Accounts and balances, with transfers between them.
- Spending and income categories with monthly budgets.
- Recurring entries (weekly, every two weeks, monthly, yearly) and savings goals.
- Reports by category and a six-month trend.
- CSV import from your bank (duplicates are skipped) and CSV or JSON export.

Amounts are stored in cents in one currency.

**Stride** is fully customizable:
- **Meals.** Rename, add, remove and reorder meal sections.
- **Exercises.** Create your own, recording reps and weight, reps only, timed holds, or cardio time and distance.
- **Routines and workouts.** Build routines, then log workouts set by set. Sets are pre-filled from last time.
- **Food bank.** `stride/data/foods.json` holds about 250 common foods with values per 100 g and typical portions, rounded from USDA FoodData Central (public domain). Pick a food and a portion and Stride estimates calories, protein, carbs and fat as you type.
- **More food options.** Custom foods, saved meals, quick add, copy from yesterday, and a water tracker.
- **Goals.** Suggested from the Mifflin-St Jeor equation, with a body weight log and progress charts.

**Tunnel** manages WireGuard profiles. A browser cannot start a system VPN, so the free WireGuard app does the tunnelling.
- **Two sources.** Import a config from a VPN provider (to change location), or run your own server. For your own server, Tunnel generates the server and device keys, assigns addresses, and writes the server's `wg0.conf` with a step-by-step Ubuntu setup.
- **Checks.** Each profile is checked for bad keys and addresses, split tunnels, IPv6 leaks, missing DNS and missing keepalive.
- **Sending a profile to a device.** Phones and iPads scan a QR code generated in the browser. Computers download a `.conf` file.
- **Keys.** They are made in the browser with X25519, and stored only in your Satchel account.

## Tests

```
cd satchel
npm test
```

This runs the following:
- **The apps suite** (`satchel/test/apps.test.cjs`). It covers sign-in gating, landing pages, cross-account isolation, CSRF, revision conflicts, input validation, export and deletion, and checks that pages contain no inline scripts or styles.
- **Five Toolkit shell suites.** These are the email, Google sign-in, upload-guard, local-runtime and data-integrity suites.
- **Almanac's calendar tests.** 101 tests taken from C.C. Lime.

Nine Toolkit suites are not yet in `npm test`: security, shell, server, mfa, hosted, remote-origin, app-saves, tokens and mcp. They still exercise Toolkit's design apps. Their app-independent checks, such as login lockout, rate limits and two-step sign-in, should be ported to the new routes.

## Not done yet

- **Real iPad testing.** Margin's pen input has been checked with simulated pen events in a desktop browser, not on a physical iPad with an Apple Pencil.
- **Reminders while closed.** In a browser, Almanac cannot remind you once its tab is closed; that would need Web Push. The desktop app avoids this by staying in the tray.
- **The Toolkit test suites** listed above still need porting.
