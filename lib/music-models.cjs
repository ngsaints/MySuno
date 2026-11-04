const YAML = require('yaml');
const SOURCE = 'https://docs.kie.ai/suno-api/generate-music.md';
const TTL = 5 * 60 * 1000;
let cached, inFlight;

function versionOf(id) {
  const match = /^V(\d+)(?:[._](\d+))?/i.exec(id);
  return match ? [Number(match[1]), Number(match[2] || 0)] : [0, 0];
}
function compareModels(a, b) {
  const av = versionOf(a), bv = versionOf(b);
  const rank = id => /^V\d+(?:[._]\d+)?$/.test(id) ? 0 : /MINI/.test(id) ? 1 : 2;
  return bv[0] - av[0] || bv[1] - av[1] || rank(a) - rank(b) || a.localeCompare(b);
}
function parseMusicModels(markdown) {
  const block = markdown.match(/```ya?ml\s*\n([\s\S]*?)```/i);
  if (!block) throw new Error('A KIE não retornou a especificação dos modelos.');
  const spec = YAML.parse(block[1]);
  const operation = spec.paths?.['/api/v1/jobs/createTask']?.post;
  const input = operation?.requestBody?.content?.['application/json']?.schema?.properties?.input;
  const model = input?.properties?.model;
  if (!Array.isArray(model?.enum)) throw new Error('O catálogo da KIE mudou de formato.');
  // Some revisions keep discontinued models in enum; the field explicitly lists active choices.
  const requiredLine = String(model.description || '').split('\n').find(line => /required.*\buse\b/i.test(line));
  const explicit = new Set(requiredLine?.match(/\bV\d+(?:[._][A-Z0-9]+)*/g) || []);
  const deprecated = new Set((operation.description?.match(/~~[\s\S]*?~~/g) || []).flatMap(text => text.match(/\bV\d+(?:[._][A-Z0-9]+)*/g) || []));
  const ids = [...new Set(model.enum)].filter(id => typeof id === 'string' && /^V\d+(?:[._][A-Z0-9]+)*$/.test(id)
    && (explicit.size ? explicit.has(id) : !deprecated.has(id)));
  if (!ids.length) throw new Error('Nenhum modelo musical ativo foi informado pela KIE.');
  ids.sort(compareModels);
  return { models: ids.map(id => ({ id, label: id.toLowerCase().replaceAll('_', '-') })), latestModel: ids[0] };
}
async function getMusicModels() {
  if (cached && Date.now() - Date.parse(cached.checkedAt) < TTL) return cached;
  if (!inFlight) inFlight = (async () => {
    const response = await fetch(SOURCE, { signal: AbortSignal.timeout(15000), redirect: 'error', cache: 'no-store' });
    if (!response.ok) throw new Error('Falha ao consultar o catálogo da KIE (HTTP ' + response.status + ').');
    cached = { ...parseMusicModels(await response.text()), checkedAt: new Date().toISOString(), source: SOURCE };
    return cached;
  })().finally(() => { inFlight = null; });
  return inFlight;
}
module.exports = { getMusicModels, parseMusicModels, compareModels };
