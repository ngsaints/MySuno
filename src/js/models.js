const CACHE_KEY = 'mysuno_music_models';
const REFRESH_MS = 5 * 60 * 1000;
let staleCatalog = false;
let catalog, lastAttempt = 0, request;
function validCatalog(value) {
  return value && Number.isFinite(Date.parse(value.checkedAt)) && Array.isArray(value.models) && value.models.length > 0
    && value.models.every(model => /^V\d+(?:[._][A-Z0-9]+)*$/.test(model.id) && typeof model.label === 'string')
    && value.models.some(model => model.id === value.latestModel);
}
function renderCatalog(select, stale) {
  staleCatalog = stale;
  const selected = select.value;
  select.replaceChildren();
  const latest = catalog.models.find(model => model.id === catalog.latestModel);
  select.add(new Option('Auto · ' + latest.label + (stale ? ' (salvo)' : ''), ''));
  for (const model of catalog.models) select.add(new Option(model.label, model.id));
  select.value = catalog.models.some(model => model.id === selected) ? selected : '';
  select.disabled = false;
  select.title = stale ? 'Último catálogo confirmado. Não foi possível atualizar agora.' : 'Atualizado pela KIE em ' + new Date(catalog.checkedAt).toLocaleString() + '. Automático usa a versão mais nova; na mesma versão, prioriza o modelo completo.';
  const engine = document.getElementById('music-engine-label');
  if (engine) engine.textContent = 'Suno · ' + (select.value ? catalog.models.find(model => model.id === select.value).label : latest.label);
}
export async function refreshMusicModels(force = false) {
  if (request) return request;
  if (!force && catalog && Date.now() - lastAttempt < REFRESH_MS) return catalog;
  lastAttempt = Date.now();
  request = (async () => {
    const select = document.getElementById('model-select');
    try {
      let result;
      if (window.mysuno?.getMusicModels) result = await window.mysuno.getMusicModels();
      else {
        const staticSite = document.querySelector('meta[name="mysuno-static"]')?.content === 'true';
        const response = await fetch(staticSite ? './data/music-models.json' : '/api/music-models', { cache: 'no-store', signal: AbortSignal.timeout(20000) });
        if (!response.ok) throw new Error('Falha ao consultar modelos (HTTP ' + response.status + ').');
        result = await response.json();
      }
      if (!validCatalog(result) || Date.now() - Date.parse(result.checkedAt) > 86400000) throw new Error('Catálogo musical inválido ou desatualizado.');
      catalog = result;
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(result)); }
      catch (error) { console.error('[MySuno] Salvar catálogo:', error.message); }
      renderCatalog(select, false);
      return catalog;
    } catch (error) {
      console.error('[MySuno] Atualizar modelos da KIE:', error.message);
      if (!catalog) {
        try {
          const saved = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
          if (validCatalog(saved) && Date.now() - Date.parse(saved.checkedAt) < 86400000) catalog = saved;
        } catch (cacheError) { console.error('[MySuno] Ler catálogo:', cacheError.message); }
      }
      if (catalog && Date.now() - Date.parse(catalog.checkedAt) < 86400000) {
        renderCatalog(select, true);
        return catalog;
      }
      catalog = null;
      select.replaceChildren(new Option('Modelos indisponíveis', ''));
      select.disabled = true;
      select.title = 'Não foi possível obter modelos confirmados pela KIE. Tente novamente em instantes.';
      throw error;
    }
  })().finally(() => { request = null; });
  return request;
}
export async function getSelectedMusicModel() {
  const current = await refreshMusicModels();
  const selected = document.getElementById('model-select').value || current.latestModel;
  if (!current.models.some(model => model.id === selected)) throw new Error('Selecione um modelo disponível na KIE.');
  return selected;
}
export function initMusicModels() {
  refreshMusicModels(true).catch(() => {}); // The loader logs failures and exposes the state in the selector.
  document.getElementById('model-select').addEventListener('change', () => { if (catalog) renderCatalog(document.getElementById('model-select'), staleCatalog); });
  window.addEventListener('focus', () => refreshMusicModels().catch(() => {}));
  setInterval(() => { if (!document.hidden) refreshMusicModels().catch(() => {}); }, REFRESH_MS);
}
