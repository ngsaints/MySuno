const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../src/js/app.js'), 'utf8')
  .replace(/import\s*\{[\s\S]*?\}\s*from\s*'[^']+';/g, '').replace(/export /g, '');
function harness(pending, rejectLookup = false) {
  const elements = new Map();
  function el(id) {
    if (!elements.has(id)) elements.set(id, {
      style: {}, disabled: false, src: '', value: '', listeners: {}, textContent: '',
      classList: { add() {}, remove() {} }, pause() {}, removeAttribute() {},
      addEventListener(event, fn) { this.listeners[event] = fn; },
      click() { return this.listeners.click?.(); }
    });
    return elements.get(id);
  }
  const storage = new Map(pending ? [['mysuno_pending_voice', JSON.stringify(pending)]] : []);
  const calls = { create: 0, wait: 0, save: 0 };
  const context = vm.createContext({
    window: { addEventListener() {} }, document: { addEventListener() {}, getElementById: el },
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    console, URL, clearInterval, setInterval,
    createCustomVoiceTask: async () => { calls.create++; },
    waitForVoiceReady: async id => { calls.wait++; assert.equal(id, 'pending-id'); if (rejectLookup) { const error = new Error('Lookup failed'); if (rejectLookup === 'auth') error.status = 401; throw error; } },
    saveCustomVoice: () => { calls.save++; }
  });
  vm.runInContext(source, context);
  vm.runInContext('showToast = () => {}; initVoiceCloneWizard();', context);
  return { el, storage, calls };
}
const pending = { taskId: 'pending-id', name: 'Minha voz', style: 'Pop', singerSkillLevel: 'intermediate' };

test('wizard resumes a persisted voice without uploading or submitting again', async () => {
  const h = harness(pending);
  await h.el('btn-open-clone-wizard').click();
  assert.equal(h.el('clone-step-2').style.display, 'block');
  assert.equal(h.el('btn-submit-step-2').disabled, false);
  await h.el('btn-submit-step-2').click();
  assert.deepEqual(h.calls, { create: 0, wait: 1, save: 1 });
  assert.equal(h.storage.has('mysuno_pending_voice'), false);
  assert.equal(h.el('clone-step-3').style.display, 'block');
});

test('failed lookup keeps the pending voice and offers another lookup', async () => {
  const h = harness(pending, true);
  await h.el('btn-open-clone-wizard').click();
  await h.el('btn-submit-step-2').click();
  assert.deepEqual(h.calls, { create: 0, wait: 1, save: 0 });
  assert.equal(h.storage.has('mysuno_pending_voice'), true);
  assert.equal(h.el('btn-submit-step-2').disabled, false);
  assert.match(h.el('btn-submit-step-2').textContent, /Retomar/);
  await h.el('btn-submit-step-2').click();
  assert.equal(h.calls.create, 0);
  assert.equal(h.calls.wait, 2);
});

test('fresh wizard keeps recording and creation blocked until the official phrase', async () => {
  const h = harness();
  await h.el('btn-open-clone-wizard').click();
  assert.equal(h.el('clone-step-1').style.display, 'block');
  assert.equal(h.el('btn-record-verify-sample').disabled, true);
  assert.equal(h.el('btn-submit-step-2').disabled, true);
});

test('authentication failure during lookup preserves the pending voice for later', async () => {
  const h = harness(pending, 'auth');
  await h.el('btn-open-clone-wizard').click();
  await h.el('btn-submit-step-2').click();
  assert.equal(h.storage.has('mysuno_pending_voice'), true);
  assert.equal(h.calls.create, 0);
});
