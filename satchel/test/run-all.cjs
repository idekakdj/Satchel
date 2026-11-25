// Run every Satchel regression suite with one command: npm test (from satchel/).
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const root = path.join(__dirname, '..', '..');
const node = process.execPath;
const suites = [
  ['Satchel apps', node, ['--test', '--test-force-exit', 'satchel/test/apps.test.cjs']],
  ['Email', node, ['--test', 'satchel/test/mail.test.cjs']],
  ['Google sign-in', node, ['--test', 'satchel/test/google.test.cjs']],
  ['Upload guard', node, ['--test', 'satchel/test/upload-guard.test.cjs']],
  ['Local runtime', node, ['--test', 'satchel/test/local-runtime.test.cjs']],
  ['Migration', node, ['--test', 'satchel/test/migration.test.cjs']],
  ['Data integrity', node, ['--test', 'satchel/test/data-integrity.test.cjs']],
  // Almanac's calendar logic (vitest, from the C.C. Lime test suite).
  ['Almanac', process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vitest', 'run'], path.join(root, 'almanac')],
];
// Not run yet: security, shell, server, mfa, hosted, remote-origin, app-saves, tokens and mcp
// suites came from Toolkit and still exercise its design apps (/sigma, /api/projects ...).
// Their app-independent checks (login lockout, rate limits, MFA) need porting to the new routes.
let failed = false;
for (const [name, cmd, args, cwd] of suites) {
  console.log(`\n=== ${name}`);
  const result = spawnSync(cmd, args, { cwd: cwd || root, stdio: 'inherit', shell: process.platform === 'win32' && cmd.endsWith('.cmd') });
  if (result.status !== 0) { failed = true; console.log(`!!! ${name} failed`); }
}
process.exit(failed ? 1 : 0);
