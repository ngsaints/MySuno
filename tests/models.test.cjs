const { test } = require('node:test');
const assert = require('node:assert/strict');
const YAML = require('yaml');
const { parseMusicModels } = require('../lib/music-models.cjs');
function document(models, description = '', operationDescription = '') {
  return '```yaml\n' + YAML.stringify({ paths: { '/api/v1/jobs/createTask': { post: {
    description: operationDescription,
    requestBody: { content: { 'application/json': { schema: { properties: { input: { properties: { model: { enum: models, description } } } } } } } }
  } } } }) + '\n```';
}
test('automatically selects a newly published generation and prefers full over variants', () => {
  const catalog = parseMusicModels(document(['V6', 'V7_MINI', 'V7_WILD', 'V7']));
  assert.equal(catalog.latestModel, 'V7');
  assert.deepEqual(catalog.models.map(m => m.id), ['V7', 'V7_MINI', 'V7_WILD', 'V6']);
});
test('handles numeric versions without lexical ordering errors', () => {
  assert.equal(parseMusicModels(document(['V9', 'V10', 'V10_5', 'V10_5_MINI'])).latestModel, 'V10_5');
});
test('ignores legacy enum entries when the KIE field explicitly lists active choices', () => {
  const catalog = parseMusicModels(document(['V4', 'V5', 'V6', 'V6_MINI'], 'Required. Use V6 or V6_MINI.'));
  assert.deepEqual(catalog.models.map(m => m.id), ['V6', 'V6_MINI']);
});
test('excludes discontinued entries marked with strikethrough', () => {
  assert.deepEqual(parseMusicModels(document(['V5', 'V6'], '', 'Discontinued: ~~V5~~')).models.map(m => m.id), ['V6']);
});
test('never invents model identifiers on empty or changed schemas', () => {
  assert.throws(() => parseMusicModels('Unavailable'));
  assert.throws(() => parseMusicModels(document([])));
  assert.throws(() => parseMusicModels(document(['not-a-suno-model'])));
});
