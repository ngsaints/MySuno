const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mysuno', {
  getMusicModels: () => ipcRenderer.invoke('mysuno:music-models'),
  request: request => ipcRenderer.invoke('mysuno:request', request)
});
