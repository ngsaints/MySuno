const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  try {
    await win.loadURL('data:text/html,<html><body></body></html>');
    const svg = fs.readFileSync(path.join(__dirname, '../src/assets/icon.svg'), 'utf8');
    for (const [name, size, inset] of [['icon-192.png',192,0], ['icon-512.png',512,0], ['icon-maskable-512.png',512,50]]) {
      const result = await win.webContents.executeJavaScript(`(async()=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=${size};const ctx=canvas.getContext('2d');ctx.fillStyle='#090a0f';ctx.fillRect(0,0,${size},${size});const img=new Image();img.src=${JSON.stringify('data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64'))};await img.decode();ctx.drawImage(img,${inset},${inset},${size-inset*2},${size-inset*2});return canvas.toDataURL('image/png').split(',')[1];})()`);
      fs.writeFileSync(path.join(__dirname,'../src/assets',name),Buffer.from(result,'base64'));
    }
    app.exit(0);
  } catch(error) {console.error(error);app.exit(1);}
});
