import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { test, afterEach } from 'node:test';
const source = await readFile(new URL('../src/js/api.js', import.meta.url), 'utf8');
const api = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
globalThis.localStorage = { getItem: () => 'test-key' };
const originalFetch = globalThis.fetch;
const originalTimer = globalThis.setTimeout;
const originalError = console.error;
afterEach(() => { globalThis.fetch = originalFetch; globalThis.setTimeout = originalTimer; console.error = originalError; });
function replies(items) {
  let count = 0;
  globalThis.fetch = async () => {
    assert.ok(count < items.length, 'Unexpected extra API call');
    const item = items[count++];
    return { ok: true, json: async () => item };
  };
  return () => count;
}
function poll(phraseOnly = false) {
  return new Promise((resolve, reject) => api.pollVoiceTask('voice-id', { phraseOnly, onReady: resolve, onError: reject }));
}
test('uses the official phrase from resultJson', async () => {
  replies([{ code: 200, data: { state: 'waiting', resultJson: JSON.stringify({ validateInfo: 'Minha frase oficial' }) } }]);
  assert.equal(await poll(true), 'Minha frase oficial');
});
test('does not invent a phrase when success has no phrase', async () => {
  replies([{ code: 200, data: { state: 'success' } }]);
  let logged = false; console.error = () => { logged = true; };
  await assert.rejects(poll(true), /não retornou a frase/);
  assert.ok(logged);
});
test('requires task success and positive availability', async () => {
  globalThis.setTimeout = fn => originalTimer(fn, 0);
  const calls = replies([
    { code: 200, data: { state: 'generating' } },
    { code: 200, data: { state: 'success' } },
    { code: 200, data: { isAvailable: false } },
    { code: 200, data: { state: 'success' } },
    { code: 200, data: { isAvailable: true } }
  ]);
  assert.equal(await api.waitForVoiceReady('voice-id'), 'voice-id');
  assert.equal(calls(), 5);
});
test('provider verification rejection is surfaced and logged', async () => {
  replies([{ code: 200, data: { state: 'fail', failReason: 'Voz rejeitada' } }]);
  let logged = false; console.error = () => { logged = true; };
  await assert.rejects(poll(), /Voz rejeitada/);
  assert.ok(logged);
});
test('missing availability never means ready', async () => {
  replies([{ code: 200, data: {} }]);
  await assert.rejects(api.checkVoiceAvailability('voice-id'), /inválida/);
});
test('API-level errors are surfaced', async () => {
  replies([{ code: 401, msg: 'Não autorizado' }]);
  console.error = () => {};
  await assert.rejects(poll(), /Não autorizado/);
});
test('cancelling an in-flight poll suppresses callbacks', async () => {
  let release;
  globalThis.fetch = () => new Promise(resolve => { release = resolve; });
  let callbacks = 0;
  const cancel = api.pollVoiceTask('voice-id', { phraseOnly: true, onReady: () => callbacks++, onError: () => callbacks++ });
  cancel();
  release({ ok: true, json: async () => ({ data: { validateInfo: 'Frase' } }) });
  await new Promise(resolve => originalTimer(resolve, 0));
  assert.equal(callbacks, 0);
});
test('generation sends the selected voice persona', async () => {
  let payload;
  globalThis.fetch = async (_url, options) => {
    payload = JSON.parse(options.body);
    return { ok: true, json: async () => ({ code: 200, data: { taskId: 'song-id' } }) };
  };
  await api.createMusicTask({ model: 'V6', personaId: 'voice-id', prompt: 'Uma música' });
  assert.equal(payload.input.persona_id, 'voice-id');
  assert.equal(payload.input.persona_model, 'voice_persona');
});
test('voice validation uses the documented snake_case fields and language code', async () => {
  let payload;
  globalThis.fetch = async (_url, options) => {
    payload = JSON.parse(options.body);
    return { ok: true, json: async () => ({ code: 200, data: { taskId: 'voice-id' } }) };
  };
  await api.createVoiceValidationTask({ voiceUrl: 'https://example.com/sample.webm', vocalEndS: 20, language: 'Portuguese' });
  assert.equal(payload.input.vocal_start_s, 0);
  assert.equal(payload.input.vocal_end_s, 20);
  assert.equal(payload.input.language, 'pt');
  assert.equal(payload.input.vocalEndS, undefined);
});

test('temporary voice lookup failures retry without creating another voice', async () => {
  globalThis.setTimeout = fn => originalTimer(fn, 0);
  console.error = () => {};
  let calls = 0;
  globalThis.fetch = async (_url, options) => {
    assert.ok(!options.body || JSON.parse(options.body).model === 'ai-music-api/check-voice');
    if (++calls === 1) throw new TypeError('Network unavailable');
    return { ok: true, json: async () => calls === 2 ? { code: 200, data: { state: 'success' } } : { code: 200, data: { isAvailable: true } } };
  };
  assert.equal(await api.waitForVoiceReady('voice-id'), 'voice-id');
  assert.equal(calls, 3);
});

test('upload falls back after HTML from the proxy and fixes the filename', async () => {
  console.error = () => {};
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(options.body.get('file').name, 'sample.m4a');
    if (calls === 1) return { ok: true, status: 200, json: async () => { throw new SyntaxError('HTML'); } };
    assert.equal(url, 'https://kieai.redpandaai.co/api/file-stream-upload');
    return { ok: true, status: 200, json: async () => ({ code: 200, data: { downloadUrl: 'https://example.com/audio.m4a' } }) };
  };
  assert.equal(await api.uploadAudioFile(new Blob(['audio'], { type: 'audio/mp4' }), 'sample.webm'), 'https://example.com/audio.m4a');
  assert.equal(calls, 2);
});

test('upload falls back after a proxy HTTP failure', async () => {
  console.error = () => {};
  let calls = 0;
  globalThis.fetch = async () => ++calls === 1
    ? { ok: false, status: 502, json: async () => ({ msg: 'Proxy offline' }) }
    : { ok: true, status: 200, json: async () => ({ code: 200, data: { downloadUrl: 'https://example.com/audio.webm' } }) };
  assert.equal(await api.uploadAudioFile(new Blob(['audio'], { type: 'audio/webm' })), 'https://example.com/audio.webm');
});

test('upload does not retry rejected credentials', async () => {
  console.error = () => {};
  let calls = 0;
  globalThis.fetch = async () => { calls++; return { ok: false, status: 401, json: async () => ({ msg: 'Unauthorized' }) }; };
  await assert.rejects(api.uploadAudioFile(new Blob(['audio'])), /Unauthorized/);
  assert.equal(calls, 1);
});

test('key test queries credit and accepts zero balance', async () => {
  globalThis.fetch = async url => {
    assert.equal(url, 'https://api.kie.ai/api/v1/chat/credit');
    return { ok: true, json: async () => ({ code: 200, data: 0 }) };
  };
  assert.equal(await api.testApiKeyConnection('test-key'), true);
});

test('key test rejects provider errors even with HTTP 200', async () => {
  replies([{ code: 500, msg: 'Unavailable' }]);
  await assert.rejects(api.testApiKeyConnection('test-key'), /Unavailable/);
});

test('history preserves real tracks whose titles contain demo cleanup keywords', () => {
  const originalStorage = globalThis.localStorage;
  let value = JSON.stringify([{ id: 'real-1', title: 'Bright Wins demo_ Yeah..' }, { id: 'demo_1' }]);
  globalThis.localStorage = { getItem: () => value, setItem: (_key, data) => { value = data; } };
  try {
    assert.equal(api.getSavedTracks().length, 1);
    api.saveTrack({ id: 'variation-1', taskId: 'task-1' });
    api.saveTrack({ id: 'variation-2', taskId: 'task-1' });
    assert.equal(api.getSavedTracks().length, 3);
    assert.equal(api.getSavedTracks().find(t => t.id === 'real-1').title, 'Bright Wins demo_ Yeah..');
  } finally { globalThis.localStorage = originalStorage; }
});

test('error diagnostics redact the locally stored key and bearer values', () => {
  const message = api.safeErrorMessage(new Error('Rejected key test-key; Authorization: Bearer another-secret-value'));
  assert.ok(!message.includes('test-key'));
  assert.ok(!message.includes('another-secret-value'));
});
