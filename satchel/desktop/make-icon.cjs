// Regenerates desktop/icon.ico from public/img/satchel.svg: npm run icon:desktop
// Electron's renderer draws the SVG at each icon size; the PNGs are packed into one .ico.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256];
const svg = fs.readFileSync(path.join(__dirname, '..', 'public', 'img', 'satchel.svg'), 'utf8');

function ico(pngs) {
  const header = Buffer.alloc(6 + 16 * pngs.length);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach(({ size, data }, i) => {
    const at = 6 + 16 * i;
    header.writeUInt8(size >= 256 ? 0 : size, at); header.writeUInt8(size >= 256 ? 0 : size, at + 1);
    header.writeUInt8(0, at + 2); header.writeUInt8(0, at + 3);
    header.writeUInt16LE(1, at + 4); header.writeUInt16LE(32, at + 6);
    header.writeUInt32LE(data.length, at + 8); header.writeUInt32LE(offset, at + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...pngs.map(p => p.data)]);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } });
  await win.loadURL('data:text/html,<html><body></body></html>');
  const urls = await win.webContents.executeJavaScript(`(async () => {
    const img = new Image();
    img.src = 'data:image/svg+xml;base64,' + ${JSON.stringify(Buffer.from(svg).toString('base64'))};
    await img.decode();
    return ${JSON.stringify(SIZES)}.map(size => {
      const c = document.createElement('canvas'); c.width = c.height = size;
      c.getContext('2d').drawImage(img, 0, 0, size, size);
      return c.toDataURL('image/png');
    });
  })()`);
  const pngs = urls.map((u, i) => ({ size: SIZES[i], data: Buffer.from(u.split(',')[1], 'base64') }));
  fs.writeFileSync(path.join(__dirname, 'icon.ico'), ico(pngs));
  console.log('Wrote desktop/icon.ico with sizes', SIZES.join(', '));
  app.quit();
}).catch(err => { console.error(err); app.exit(1); });
