const { app, BrowserWindow, session } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
let server, directory, win;
app.whenReady().then(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mysuno-pwa-'));
  fs.cpSync(path.join(__dirname, '../dist/web'), directory, {recursive:true});
  const types = {'.html':'text/html','.js':'application/javascript','.json':'application/json','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.ttf':'font/ttf'};
  server = http.createServer((req,res) => {
    const name = new URL(req.url,'http://localhost').pathname.replace(/^\/MySuno\//,'') || 'index.html';
    const file = path.resolve(directory,name);
    if (!file.startsWith(directory+path.sep)) {res.writeHead(403);res.end();return;}
    try {res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(fs.readFileSync(file));}
    catch {res.writeHead(404);res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url='http://127.0.0.1:'+server.address().port+'/MySuno/';
  const testSession=session.fromPartition('mysuno-pwa-'+Date.now());
  win=new BrowserWindow({show:false,width:1440,height:960,webPreferences:{session:testSession,sandbox:true,contextIsolation:true,nodeIntegration:false}});
  const errors=[];
  win.webContents.on('console-message',(_event,level,message)=>{if(level===3)errors.push(message);});
  await win.loadURL(url);
  await win.webContents.executeJavaScript(`(async()=>{
    const {getSelectedMusicModel}=await import('./js/models.js');
    await getSelectedMusicModel();
    await navigator.serviceWorker.ready;
    await document.fonts.ready;
  })()`);
  await new Promise(resolve=>setTimeout(resolve,300));
  fs.mkdirSync(path.join(__dirname,'../.github/assets'),{recursive:true});
  fs.writeFileSync(path.join(__dirname,'../.github/assets/preview.png'),(await win.webContents.capturePage()).toPNG());
  win.webContents.debugger.attach('1.3');
  const install=await win.webContents.debugger.sendCommand('Page.getInstallabilityErrors');
  assert.deepEqual(install.installabilityErrors,[]);
  await require('./speech-browser.cjs')(win);
  await win.webContents.executeJavaScript(`localStorage.setItem('mysuno_kie_api_key','pwa-local-test-only');localStorage.setItem('mysuno_tracks_history',JSON.stringify([{id:'pwa-test-track',title:'Minha faixa local'}]));`);
  const swFile=path.join(directory,'sw.js');
  fs.writeFileSync(swFile,fs.readFileSync(swFile,'utf8').replace(/const VERSION = "([^"]+)";/,'const VERSION = "$1-update-test";'));
  await win.webContents.executeJavaScript(`(async()=>{
    window.__pwaSmokeBusy=true;
    window.addEventListener('mysuno:before-update',event=>{if(window.__pwaSmokeBusy)event.preventDefault();});
    const registration=await navigator.serviceWorker.getRegistration();
    await registration.update();
    for(let i=0;i<100&&!registration.waiting;i++)await new Promise(resolve=>setTimeout(resolve,100));
    if(!registration.waiting)throw new Error('Update did not enter waiting state');
    document.getElementById('pwa-update-btn').click();
  })()`);
  await new Promise(resolve=>setTimeout(resolve,600));
  assert.match(await win.webContents.executeJavaScript(`document.getElementById('pwa-status').textContent`),/Finalize/);
  const loaded=new Promise(resolve=>win.webContents.once('did-finish-load',resolve));
  await win.webContents.executeJavaScript(`window.__pwaSmokeBusy=false;document.getElementById('pwa-update-btn').click();`);
  await loaded;
  const preserved=await win.webContents.executeJavaScript(`({key:localStorage.getItem('mysuno_kie_api_key')==='pwa-local-test-only',track:JSON.parse(localStorage.getItem('mysuno_tracks_history'))[0].id==='pwa-test-track'})`);
  assert.deepEqual(preserved,{key:true,track:true});
  const cached=await win.webContents.executeJavaScript(`(async()=>{const keys=await caches.keys();const requests=(await Promise.all(keys.map(async name=>(await (await caches.open(name)).keys()).map(request=>request.url)))).flat();return {keys,requests};})()`);
  assert.ok(cached.keys.some(name=>name.endsWith('-update-test')));
  assert.ok(cached.requests.every(url=>!url.includes('/api/')&&!url.includes('kie.ai')&&!url.includes('upload')));
  await win.webContents.debugger.sendCommand('Network.enable');
  await win.webContents.debugger.sendCommand('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
  await win.reload();
  await new Promise(resolve=>win.webContents.once('did-finish-load',resolve));
  const offline=await win.webContents.executeJavaScript(`({title:document.title,key:localStorage.getItem('mysuno_kie_api_key')==='pwa-local-test-only',font:document.fonts.check('14px Manrope')})`);
  assert.match(offline.title,/MySuno/);assert.equal(offline.key,true);
  assert.equal(errors.filter(message=>!message.includes('Atualizar modelos')&&!message.includes('ERR_INTERNET_DISCONNECTED')&&!message.includes('Verificar atualização')).length,0,errors.join('\n'));
  console.log('PWA smoke passed: installable, subpath hosting, update prompt, busy guard, local data retained, offline shell and public-only caches.');
  cleanup();app.exit(0);
}).catch(error=>{console.error(error);cleanup();app.exit(1);});
function cleanup(){
  if(win&&!win.isDestroyed())win.destroy();
  server?.close();
  if(directory&&path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(directory).startsWith('mysuno-pwa-'))fs.rmSync(directory,{recursive:true,force:true});
}
