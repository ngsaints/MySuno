const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
module.exports = async function exerciseSpeech(win) {
  await win.webContents.executeJavaScript(`
    document.getElementById('kind-speech').click();
    document.getElementById('speech-mode').value='advanced';
    document.getElementById('speech-mode').dispatchEvent(new Event('change'));
    document.getElementById('speech-title').value='Boas-vindas ao podcast';
    document.getElementById('speech-text').value='Olá! Seja bem-vindo. Hoje vamos transformar boas ideias em novas histórias.';
    document.getElementById('speech-tone').value='Português brasileiro, tom acolhedor, ritmo calmo e natural.';
    document.getElementById('speech-text').dispatchEvent(new Event('input'));
    document.getElementById('speech-tone').dispatchEvent(new Event('input'));
  `);
  await new Promise(resolve => setTimeout(resolve, 200));
  fs.writeFileSync(path.join(__dirname,'../.github/assets/speech.png'),(await win.webContents.capturePage()).toPNG());
  win.setContentSize(390, 844);
  await new Promise(resolve => setTimeout(resolve, 200));
  const mobile = await win.webContents.executeJavaScript("({width:innerWidth,overflow:document.querySelector('.app-container').scrollWidth>innerWidth,advancedHidden:document.getElementById('speech-advanced').hidden})");
  assert.equal(mobile.overflow, false);
  assert.equal(mobile.advancedHidden, false);
  fs.mkdirSync(path.join(__dirname, '../.preview'), {recursive:true});
  fs.writeFileSync(path.join(__dirname, '../.preview/speech-mobile.png'), (await win.webContents.capturePage()).toPNG());
  win.setContentSize(1440, 960);
  const result = await win.webContents.executeJavaScript(`(async()=>{
    const api=await import('./js/api.js');
    const {player}=await import('./js/player.js');
    const originalFetch=window.fetch;
    player.loadTrack=track=>{window.__speechPlayed=track;};
    localStorage.setItem('mysuno_kie_api_key','browser-speech-only');
    const payloads=[];
    window.fetch=async function(url,options){
      if(typeof url==='string'&&url.startsWith('https://api.kie.ai/api/v1/jobs/')){
        if(url.endsWith('/createTask')){
          payloads.push(JSON.parse(options.body));
          return new Response(JSON.stringify({code:200,data:{taskId:'browser-speech-'+payloads.length}}),{status:200});
        }
        const id=new URL(url).searchParams.get('taskId');
        return new Response(JSON.stringify({code:200,data:{state:'success',response:{data:[
          {id:id+'-a',audio_url:'https://example.com/'+id+'-a.mp3',duration:12},
          {id:id+'-b',stream_audio_url:'https://example.com/'+id+'-b.mp3',duration:13}
        ]}}}),{status:200});
      }
      return originalFetch.apply(this,arguments);
    };
    try{
      const field=id=>document.getElementById(id);
      field('speech-background').checked=true;
      field('speech-mode').value='simple';field('speech-mode').dispatchEvent(new Event('change'));
      field('speech-text').value='Abertura de um podcast em português.';
      field('speech-form').requestSubmit();
      for(let i=0;i<100&&api.getSavedTracks().filter(t=>t.kind==='speech'&&t.status==='success').length<2;i++)await new Promise(r=>setTimeout(r,25));
      const firstCount=api.getSavedTracks().length;
      field('speech-mode').value='advanced';field('speech-mode').dispatchEvent(new Event('change'));
      const restoredDraft=field('speech-text').value.startsWith('Olá!');
      field('speech-gender').value='f';field('speech-variety').value='0';field('speech-background').checked=false;
      field('speech-form').requestSubmit();
      for(let i=0;i<100&&api.getSavedTracks().filter(t=>t.kind==='speech'&&t.status==='success').length<4;i++)await new Promise(r=>setTimeout(r,25));
      const second=payloads[1]?.input;
      return {firstCount,count:api.getSavedTracks().length,requests:payloads.length,
        simpleOnly:JSON.stringify(Object.keys(payloads[0]?.input).sort())===JSON.stringify(['customMode','prompt']),
        advancedOnly:second?.customMode===true&&!('prompt' in second)&&second?.vocalGender==='f'&&second?.variety===0&&second?.backgroundMusic===false,
        restoredDraft,badges:document.querySelectorAll('.speech-badge').length,
        played:window.__speechPlayed?.kind==='speech'&&window.__speechPlayed?.title.includes('versão 1')};
    }finally{window.fetch=originalFetch;}
  })()`);
  assert.deepEqual(result,{firstCount:2,count:4,requests:2,simpleOnly:true,advancedOnly:true,restoredDraft:true,badges:4,played:true});
};
