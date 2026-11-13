import { readFile } from 'node:fs/promises';
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
const source = await readFile(new URL('../src/js/api.js', import.meta.url), 'utf8');
const api = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const storage = new Map([['mysuno_kie_api_key','speech-test-key']]);
globalThis.localStorage = {getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)};
const originalFetch=globalThis.fetch,originalTimer=globalThis.setTimeout,originalError=console.error;
afterEach(()=>{globalThis.fetch=originalFetch;globalThis.setTimeout=originalTimer;console.error=originalError;storage.delete('mysuno_tracks_history');});
test('simple speech sends only customMode and prompt, even after advanced mode',()=>{
 assert.deepEqual(api.buildSpeechPayload({customMode:false,prompt:'  Uma abertura  ',script:'old script',tone:'old tone',variety:4,vocalGender:'m',backgroundMusic:true,personaId:'old voice'}),{model:'ai-music-api/speech',input:{customMode:false,prompt:'Uma abertura'}});
});
test('advanced speech preserves false, zero, multiline script and exact camelCase fields',()=>{
 assert.deepEqual(api.buildSpeechPayload({customMode:true,prompt:'old idea',script:'Olá!\nBom dia.',tone:' Calmo ',variety:0,vocalGender:'F',backgroundMusic:false}),{model:'ai-music-api/speech',input:{customMode:true,script:'Olá!\nBom dia.',tone:'Calmo',variety:0,vocalGender:'f',backgroundMusic:false}});
});
test('optional advanced values can be omitted',()=>{
 assert.deepEqual(api.buildSpeechPayload({customMode:true,script:'Olá'}).input,{customMode:true,script:'Olá'});
});
test('speech rejects empty and oversized texts instead of truncating the script',()=>{
 for(const options of [{prompt:' '},{prompt:'a'.repeat(3001)},{customMode:true,script:' '},{customMode:true,script:'a'.repeat(5001)},{customMode:true,script:'Oi',tone:'a'.repeat(1001)}])assert.throws(()=>api.buildSpeechPayload(options));
 assert.equal(api.buildSpeechPayload({customMode:true,script:'a'.repeat(5000)}).input.script.length,5000);
});
test('speech rejects unsupported voice and variety settings',()=>{
 for(const settings of [{variety:-1},{variety:5},{variety:1.5},{vocalGender:'female'},{backgroundMusic:'false'}])assert.throws(()=>api.buildSpeechPayload({customMode:true,script:'Oi',...settings}));
});
test('speech creates one task with the user key without adding a music model or callback',async()=>{
 let calls=0;
 globalThis.fetch=async(url,options)=>{calls++;assert.equal(url,'https://api.kie.ai/api/v1/jobs/createTask');assert.equal(options.headers.Authorization,'Bearer speech-test-key');assert.deepEqual(JSON.parse(options.body),{model:'ai-music-api/speech',input:{customMode:false,prompt:'Olá'}});return{ok:true,json:async()=>({code:200,data:{taskId:'speech-task'}})};};
 assert.equal((await api.createSpeechTask({prompt:'Olá'})).taskId,'speech-task');assert.equal(calls,1);
});
test('HTTP 200 with code 402 fails and redacts the key',async()=>{
 globalThis.fetch=async()=>({ok:true,json:async()=>({code:402,msg:'No credits for speech-test-key'})});
 await assert.rejects(api.createSpeechTask({prompt:'Olá'}),error=>error.status===402&&!error.message.includes('speech-test-key'));
});
test('speech never treats task acceptance without an ID as ready audio',async()=>{
 globalThis.fetch=async()=>({ok:true,json:async()=>({code:200,data:{}})});
 await assert.rejects(api.createSpeechTask({prompt:'Olá'}),/identificador/);
});
test('both official speech takes are parsed and saved with local metadata',()=>{
 api.saveTrack({id:'task_speech-task',taskId:'speech-task',kind:'speech',title:'Meu podcast',style:'Calmo',status:'generating'});
 const tracks=api.extractAudioTracks({response:{data:[{id:'take1',audio_url:'https://example.com/1.mp3',duration:10},{id:'take2',stream_audio_url:'https://example.com/2.mp3',duration:11}]}});
 const completed=api.saveTaskResults('speech-task',tracks);
 assert.equal(completed.length,2);assert.ok(completed.every(t=>t.kind==='speech'&&t.status==='success'));
 assert.equal(completed[0].title,'Meu podcast · versão 1');assert.equal(completed[1].title,'Meu podcast · versão 2');
 assert.equal(api.getSavedTracks().length,2);assert.equal(api.getSavedTracks().some(t=>t.id==='task_speech-task'),false);
});
test('resultJson music responses still produce playable audio',()=>{
 assert.equal(api.extractAudioTracks({resultJson:JSON.stringify({data:[{id:'song',audio_url:'https://example.com/song.mp3'}]})})[0].id,'song');
 assert.equal(api.extractAudioTracks({resultJson:JSON.stringify({resultUrls:['https://example.com/1.mp3','https://example.com/2.mp3']})}).length,2);
});
test('polling rejects success without audio and preserves its pending record',async()=>{
 console.error=()=>{};api.saveTrack({id:'task_empty',taskId:'empty',kind:'speech',status:'generating'});
 globalThis.fetch=async()=>({ok:true,json:async()=>({code:200,data:{state:'success',response:{data:[]}}})});
 await assert.rejects(new Promise((resolve,reject)=>api.startPollingTask('empty',{onComplete:resolve,onError:reject})),/sem retornar áudios/);
 assert.equal(api.getSavedTracks()[0].id,'task_empty');
});
test('polling cancellation suppresses in-flight network errors',async()=>{
 let release,calls=0;
 globalThis.fetch=()=>new Promise((_resolve,reject)=>{release=reject;});
 const cancel=api.startPollingTask('cancelled',{onComplete:()=>calls++,onError:()=>calls++});
 while(!release)await new Promise(resolve=>originalTimer(resolve,1));
 cancel();release(new TypeError('Network disconnected'));
 await new Promise(resolve=>originalTimer(resolve,5));assert.equal(calls,0);
});
test('official response tracks take precedence over an empty resultJson field',()=>{
 assert.equal(api.extractAudioTracks({resultJson:'',response:{data:[{id:'speech-a',audio_url:'https://example.com/a.mp3'},null]}}).length,1);
});
