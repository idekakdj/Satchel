// electron-builder settings for the Windows installer (npm run build:desktop).
module.exports = {
  appId: 'com.satchel.desktop', productName: 'Satchel',
  extraMetadata: { main: 'desktop/main.cjs' },
  directories: { output: '../dist', buildResources: 'desktop' },
  files: ['desktop/main.cjs', 'desktop/runtime.cjs', 'desktop/icon.ico', 'server/**/*.js', 'server/**/*.cjs', 'package.json'],
  extraResources: [
    { from: 'public', to: 'workspace/satchel/public' },
    // Almanac must be built first (npm run build): app/ is the interface, server/ the calendar service.
    { from: '../almanac', to: 'workspace/almanac', filter: ['index.html', 'img/**/*', 'app/**/*', 'server/**/*'] },
    { from: '../margin', to: 'workspace/margin', filter: ['index.html', 'app.html', 'css/**/*', 'js/**/*', 'img/**/*'] },
    { from: '../ledger', to: 'workspace/ledger', filter: ['index.html', 'app.html', 'css/**/*', 'js/**/*', 'img/**/*'] },
    { from: '../stride', to: 'workspace/stride', filter: ['index.html', 'app.html', 'css/**/*', 'js/**/*', 'img/**/*', 'data/**/*'] },
    { from: '../tunnel', to: 'workspace/tunnel', filter: ['index.html', 'app.html', 'css/**/*', 'js/**/*', 'img/**/*'] },
  ],
  asar: true,
  win: { target: [{ target: 'nsis', arch: ['x64'] }], icon: 'desktop/icon.ico', artifactName: 'Satchel-Setup-${version}-${arch}.${ext}' },
  nsis: { oneClick: false, perMachine: false, allowElevation: false, allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true, createStartMenuShortcut: true, shortcutName: 'Satchel',
    deleteAppDataOnUninstall: false, runAfterFinish: true },
};
