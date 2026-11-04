const { app } = require('electron');
const assert = require('node:assert/strict');
const { createWindow } = require('../electron/main');
app.whenReady().then(async () => {
  const win = createWindow({ show: false });
  const errors = [];
  win.webContents.on('console-message', (_event, level, message) => { if (level === 3) errors.push(message); });
  try {
    await new Promise((resolve, reject) => { win.webContents.once('did-finish-load', resolve); win.webContents.once('did-fail-load', (_e, _code, message) => reject(new Error(message))); });
    const result = await win.webContents.executeJavaScript(`(async () => {
      const { getSavedTracks } = await import('./js/api.js');
      const { getSelectedMusicModel } = await import('./js/models.js');
      const model = await getSelectedMusicModel();
      if (!/^V[0-9]/.test(model) || document.getElementById('model-select').disabled) throw new Error('Dynamic model selector failed');
      const original = localStorage.getItem('mysuno_tracks_history');
      const pending = localStorage.getItem('mysuno_pending_voice');
      try {
        localStorage.setItem('mysuno_tracks_history', JSON.stringify([{id:'smoke-real',title:'Bright Wins demo_ Yeah..'}]));
        localStorage.setItem('mysuno_pending_voice', JSON.stringify({taskId:'smoke-pending',name:'Teste',style:'Pop',singerSkillLevel:'intermediate'}));
        document.getElementById('btn-open-clone-wizard').click();
        const resumed = document.getElementById('clone-step-2').style.display === 'block'
          && !document.getElementById('btn-submit-step-2').disabled
          && document.getElementById('btn-submit-step-2').textContent.includes('Retomar');
        document.getElementById('voice-clone-close-btn').click();
        document.getElementById('search-input').dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('[data-track-action="like"]').click();
        const liked = getSavedTracks()[0].liked === true;
        const close = document.querySelector('[data-close-modal="settings-modal"]');
        document.getElementById('settings-modal').classList.add('active');
        close.click();
        const closed = !document.getElementById('settings-modal').classList.contains('active');
        const rejected = await window.mysuno.request({url:'https://example.com',method:'GET'});
        return { node: typeof window.require, bridge: typeof window.mysuno.request, tracks:getSavedTracks().length, resumed, liked, closed, rejected:!!rejected.error };
      } finally {
        if (original === null) localStorage.removeItem('mysuno_tracks_history'); else localStorage.setItem('mysuno_tracks_history',original);
        if (pending === null) localStorage.removeItem('mysuno_pending_voice'); else localStorage.setItem('mysuno_pending_voice',pending);
      }
    })()`);
    assert.deepEqual(result, { node: 'undefined', bridge: 'function', tracks: 1, resumed: true, liked: true, closed: true, rejected: true });
    assert.equal(errors.length, 0, errors.join('\n'));
    const preferences = win.webContents.getLastWebPreferences();
    assert.equal(preferences.webSecurity, true);
    assert.equal(preferences.contextIsolation, true);
    assert.equal(preferences.sandbox, true);
    console.log('Electron smoke passed: secure renderer, modules, restricted bridge, history and pending voice UI.');
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
}).catch(error => { console.error(error); app.exit(1); });
