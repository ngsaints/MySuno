const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateRequest, performRequest } = require('../electron/network');

test('desktop bridge restricts hosts, paths, methods, and upload shape', () => {
  assert.doesNotThrow(() => validateRequest({ url: 'https://api.kie.ai/api/v1/chat/credit', method: 'GET' }));
  for (const url of ['https://evil.example/api/v1/chat/credit', 'http://api.kie.ai/api/v1/chat/credit', 'https://api.kie.ai/anything', 'https://user:secret@api.kie.ai/api/v1/chat/credit']) {
    assert.throws(() => validateRequest({ url, method: 'GET' }));
  }
  assert.throws(() => validateRequest({ url: 'https://api.kie.ai/api/v1/jobs/createTask', method: 'GET' }));
  assert.throws(() => validateRequest({ url: 'https://kieai.redpandaai.co/api/file-stream-upload', method: 'POST' }));
});

test('desktop bridge does not forward extra headers or follow redirects', async () => {
  const original = global.fetch;
  global.fetch = async (_url, options) => {
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Cookie, undefined);
    assert.equal(options.headers.Authorization, 'Bearer test-key');
    return { status: 200, text: async () => '{"code":200,"data":0}' };
  };
  try {
    const response = await performRequest({ url: 'https://api.kie.ai/api/v1/chat/credit', method: 'GET', headers: { Authorization: 'Bearer test-key', Cookie: 'not-forwarded' } });
    assert.equal(response.status, 200);
  } finally { global.fetch = original; }
});
