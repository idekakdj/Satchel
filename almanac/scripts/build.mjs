// Builds Almanac for the Satchel shell:
//   app/     the React calendar (static files served at /almanac/app/)
//   server/  the calendar service bundled for the Satchel Express server
import { build as vite } from 'vite';
import react from '@vitejs/plugin-react';
import { build as esbuild } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
await vite({
  configFile: false, root: path.join(root, 'src/renderer'), base: '/almanac/app/', plugins: [react()], logLevel: 'warn',
  build: { outDir: path.join(root, 'app'), emptyOutDir: true, modulePreload: { polyfill: false }, assetsInlineLimit: 0, sourcemap: false },
  worker: { format: 'es' },
});
await esbuild({
  entryPoints: [path.join(root, 'src/server/service.ts')], outfile: path.join(root, 'server/almanac-service.cjs'),
  bundle: true, platform: 'node', format: 'cjs', target: 'node22', logLevel: 'warning', legalComments: 'none',
});
console.log('Almanac built: app/ and server/almanac-service.cjs');
