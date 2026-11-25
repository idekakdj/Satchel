const { startLocalRuntime } = require('../server/local-runtime');

// The desktop app always runs its own loopback server on port 4320, or joins one that
// `npm start` already runs against the same data folder (see server/local-runtime.js).
async function startRuntime({ dataDir, assetRoot }) {
  process.env.NODE_ENV = 'production';
  return startLocalRuntime({ dataDir, assetRoot, port: process.env.SATCHEL_DESKTOP_TEST_DIR ? 0 : 4320 });
}
module.exports = { startRuntime };
