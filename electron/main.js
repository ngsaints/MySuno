const { app, BrowserWindow, shell, ipcMain } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const { performRequest } = require('./network');
const { getMusicModels } = require('../lib/music-models.cjs');
const appURL = pathToFileURL(path.join(__dirname, '../src/index.html')).href;

ipcMain.handle('mysuno:music-models', async event => {
  if (event.senderFrame !== event.sender.mainFrame || event.senderFrame.url.split('#')[0] !== appURL) throw new Error('Origem não permitida.');
  try { return await getMusicModels(); }
  catch (err) { console.error('[MySuno] Catálogo musical:', err.message); throw new Error('Não foi possível atualizar os modelos da KIE.'); }
});

ipcMain.handle('mysuno:request', async (event, request) => {
  if (event.senderFrame !== event.sender.mainFrame || event.senderFrame.url.split('#')[0] !== appURL) {
    throw new Error('Origem não permitida.');
  }
  try { return await performRequest(request); }
  catch (err) {
    console.error('[MySuno] Rede:', err.message);
    return { error: err.message };
  }
});

function createWindow({ show = true } = {}) {
  const win = new BrowserWindow({
    show,
    width: 1320,
    height: 860,
    minWidth: 420,
    minHeight: 600,
    backgroundColor: '#0d0e12',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  win.loadFile(path.join(__dirname, '../src/index.html'));
  win.webContents.on('will-navigate', event => event.preventDefault());

  // Abrir links externos no navegador padrão do usuário
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch(err => console.error('[MySuno] Abrir link:', err.message));
    return { action: 'deny' };
  });
  return win;
}

if (require.main === module) app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

module.exports = { createWindow };

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
