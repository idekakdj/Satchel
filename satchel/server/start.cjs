// Local secrets (satchel/.env, git-ignored) load first so every module sees them.
require('./env-file').loadEnvFile();
const { startLocalRuntime } = require('./local-runtime');
startLocalRuntime().then(runtime => {
  console.log(`Satchel ${runtime.reused ? 'already running' : 'running'} at ${runtime.origin}`);
  if (runtime.reused) {
    console.log('(An already-running Satchel, such as the desktop app, keeps its own settings; close it to apply changes in .env.)');
    process.exit(0);
  }
  if (!require('./google').configured()) console.log('Google sign-in is off: add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to satchel/.env to turn it on.');
}).catch(err => { console.error(err.message); process.exit(1); });
