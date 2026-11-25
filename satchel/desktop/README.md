# Satchel for Windows

The desktop app is an Electron window around Satchel's own local server, with all five apps
inside. People who install it don't need Node.js or a terminal. The Windows x64 installer has a
setup wizard, lets you choose the install folder, and adds Start Menu and desktop shortcuts and
an uninstaller.

## Build

From `satchel/`, with Node.js installed:

```powershell
npm install
npm run build
npm run build:desktop
```

`npm run build` must run first: it builds Almanac, and the installer packs the built `almanac/app`
and `almanac/server`. The installer lands in `dist/Satchel-Setup-<version>-x64.exe` at the
workspace root. `npm run desktop` runs the app straight from the source folders, without
building an installer.

To change the icon, edit `public/img/satchel.svg` and run `npm run icon:desktop`. That rewrites
`desktop/icon.ico`.

## How it behaves

- **Data.** It uses the same data folder as `npm start`: `%APPDATA%\Satchel\data`. Installing,
  updating or uninstalling the app leaves that folder alone.
- **Browser access.** While the app runs, Satchel is also open in a web browser at
  http://127.0.0.1:4320. If `npm start` is already running, the app joins that server instead of
  starting a second one. The browser and the app keep separate sign-ins but share accounts and data.
- **The tray.** Closing the window hides Satchel in the system tray, so open tabs keep running and
  Almanac reminders still arrive. **Quit Satchel**, in the tray menu or the Satchel menu, exits.
- **Start with Windows.** A checkbox in the Satchel menu. When it's on, Satchel starts hidden in the
  tray at sign-in, so reminders work all day.
- **Google sign-in.** Google refuses sign-in inside app windows, so it opens your normal browser.
  The keys go in `%APPDATA%\Satchel\.env`; **Satchel > Set up Google sign-in** creates that file.

## Security

- **Server.** It listens only on `127.0.0.1` and accepts only local host headers.
- **Pages.** Pages have no Node.js access, and context isolation, the sandbox and web security
  are on.
- **Navigation.** The window refuses to go to other sites, and links that would open new windows
  are blocked.
- **Permissions.** Satchel's own pages may show notifications (Almanac reminders) and write to the
  clipboard (Tunnel's Copy buttons). Every other permission, such as camera, microphone or
  location, is denied.

The build is not code-signed, so Windows may say the publisher is unknown.
