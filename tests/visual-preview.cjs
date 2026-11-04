const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { createWindow } = require('../electron/main');
app.whenReady().then(async () => {
  const win = createWindow({show:false});
  try {
    await new Promise(resolve => win.webContents.once('did-finish-load',resolve));
    await win.webContents.executeJavaScript('document.fonts.ready');
    fs.mkdirSync(path.join(__dirname,'../.preview'),{recursive:true});
    for (const [name,width,height] of [['desktop',1440,960],['mobile',390,844]]) {
      win.setMinimumSize(320,400);
      win.setContentSize(width,height);
      await new Promise(resolve=>setTimeout(resolve,300));
      const layout = await win.webContents.executeJavaScript(`({font: getComputedStyle(document.body).fontFamily, loaded:document.fonts.check('14px Manrope'), width:innerWidth, overflow:document.querySelector('.app-container').scrollWidth > innerWidth, player:document.querySelector('.bottom-player').getBoundingClientRect().toJSON()})`);
      console.log(name, JSON.stringify(layout));
      fs.writeFileSync(path.join(__dirname,'../.preview/'+name+'.png'),(await win.webContents.capturePage()).toPNG());
    }
    app.exit(0);
  } catch(error) { console.error(error);app.exit(1); }
});
