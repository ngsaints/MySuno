/**
 * MySuno - KIE.AI & Suno V6 Integration Layer
 * Client-Side / Self-Hosted BYOK (Bring Your Own Key) Engine
 */

const KIE_API_BASE = 'https://api.kie.ai';
const STORAGE_KEY_API = 'mysuno_kie_api_key';
const STORAGE_KEY_TRACKS = 'mysuno_tracks_history';

// Desktop requests run in the main process without weakening renderer security.
async function kieFetch(url, options = {}) {
  if (!globalThis.window?.mysuno?.request) return fetch(url, options);
  const request = { url, method: options.method || 'GET', headers: options.headers, body: options.body };
  if (options.body instanceof FormData) {
    const file = options.body.get('file');
    request.body = undefined;
    request.upload = { bytes: new Uint8Array(await file.arrayBuffer()), type: file.type, name: file.name };
  }
  const result = await window.mysuno.request(request);
  if (result.error) { const error = new Error(result.error); error.transient = true; throw error; }
  return { ok: result.status >= 200 && result.status < 300, status: result.status,
    statusText: String(result.status), json: async () => JSON.parse(result.body) };
}

export function safeErrorMessage(value) {
  let message = String(value?.message || value || 'Erro desconhecido.');
  try {
    const key = localStorage.getItem(STORAGE_KEY_API);
    if (key) message = message.split(key).join('[chave oculta]');
  } catch {}
  return message.replace(/Bearer\s+[^\s"'<>]+/gi, 'Bearer [oculto]');
}

function apiError(message, status) {
  const error = new Error(safeErrorMessage(message));
  error.status = status;
  error.transient = status === 408 || status === 429 || status >= 500;
  return error;
}

// 1. Manage API Key
export function getApiKey() {
  return localStorage.getItem(STORAGE_KEY_API) || '';
}

export function saveApiKey(key) {
  const cleanKey = (key || '').trim();
  localStorage.setItem(STORAGE_KEY_API, cleanKey);
  return cleanKey;
}

export function hasApiKey() {
  return Boolean(getApiKey());
}

/**
 * Test API Key validity
 */
export async function testApiKeyConnection(key) {
  const apiKey = (key || getApiKey()).trim();
  if (!apiKey) throw new Error('Por favor, informe uma chave da KIE.');

  const res = await kieFetch(KIE_API_BASE + '/api/v1/chat/credit', {
    signal: AbortSignal.timeout(30000), method: 'GET', headers: { Authorization: 'Bearer ' + apiKey }
  });
  const data = await res.json();
  if (!res.ok || data.code !== 200 || typeof data.data !== 'number' || !Number.isFinite(data.data)) {
    throw apiError(data.msg || 'Não foi possível validar a chave da KIE.', res.ok ? data.code : res.status);
  }
  return true;
}

// 2. Manage Track History (100% Real — Apenas faixas geradas pela API)
export function getSavedTracks() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_TRACKS);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Remove qualquer resquício de dados de demonstração
      const realTracks = Array.isArray(parsed) ? parsed.filter(t => typeof t?.id === 'string' && !t.id.startsWith('demo_')) : [];
      return realTracks;
    }
  } catch (e) {
    console.error('Erro ao ler faixas locais:', e);
  }
  return [];
}

export function saveTrack(track) {
  const tracks = getSavedTracks();
  const index = tracks.findIndex(t => t.id === track.id || (t.taskId && t.taskId === track.taskId && track.variationIndex != null && t.variationIndex === track.variationIndex));
  
  if (index >= 0) {
    tracks[index] = { ...tracks[index], ...track };
  } else {
    tracks.unshift(track); // Adiciona a mais nova no topo
  }
  
  localStorage.setItem(STORAGE_KEY_TRACKS, JSON.stringify(tracks));
  return tracks;
}

export function removeTrack(id) {
  const tracks = getSavedTracks().filter(t => t.id !== id && t.taskId !== id);
  localStorage.setItem(STORAGE_KEY_TRACKS, JSON.stringify(tracks));
  return tracks;
}

/**
 * 3. Criar Tarefa no KIE.AI (Generate, Cover, Extend, Stems, Cover Image)
 */
export async function createMusicTask(options) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('Chave KIE.AI não encontrada. Por favor, cadastre sua API Key nas configurações.');
  }

  const {
    operation = 'ai-music-api/generate',
    model,
    customMode = false,
    instrumental = false,
    title = '',
    style = '',
    lyrics = '',
    prompt = '',
    uploadUrl = '',
    taskId = '',
    audioId = '',
    continueAt = null,
    personaId = null,
    personaModel = 'voice_persona'
  } = options;

  if (!model && !['ai-music-api/cover-generate', 'ai-music-api/separate-vocals'].includes(operation)) throw new Error('Escolha um modelo confirmado no catálogo da KIE.');

  const payload = {
    model: operation,
    input: {
      model: model,
      instrumental: instrumental
    }
  };

  if (personaId) {
    payload.input.persona_id = personaId;
    payload.input.persona_model = personaModel;
  }

  // Mapeamento conforme documentação KIE Suno V6
  if (operation === 'ai-music-api/generate') {
    payload.input.custom_mode = customMode;
    if (customMode) {
      if (title) payload.input.title = title.substring(0, 80);
      if (style) payload.input.style = style.substring(0, 1000);
      if (lyrics) payload.input.lyrics = lyrics.substring(0, 5000);
      if (prompt && !lyrics) payload.input.prompt = prompt;
    } else {
      payload.input.prompt = prompt || style || title;
    }
  } else if (operation === 'ai-music-api/upload-and-cover-audio') {
    // Cover pode usar upload_url OU task_id + audio_id de faixa anterior
    if (uploadUrl) {
      payload.input.upload_url = uploadUrl;
    } else if (taskId && audioId) {
      payload.input.task_id = taskId;
      payload.input.audio_id = audioId;
    }
    if (title) payload.input.title = title.substring(0, 80);
    const effectiveStyle = style || prompt;
    if (effectiveStyle) payload.input.style = effectiveStyle.substring(0, 1000);
    if (lyrics) payload.input.lyrics = lyrics.substring(0, 5000);
  } else if (operation === 'ai-music-api/upload-and-extend-audio' || operation === 'ai-music-api/extend') {
    if (uploadUrl) payload.input.upload_url = uploadUrl;
    if (taskId && audioId) {
      payload.input.task_id = taskId;
      payload.input.audio_id = audioId;
    }
    if (continueAt) payload.input.continue_at = parseFloat(continueAt);
    const effectiveStyle = style || prompt;
    if (effectiveStyle) payload.input.style = effectiveStyle.substring(0, 1000);
    if (lyrics) payload.input.lyrics = lyrics.substring(0, 5000);
  } else if (operation === 'ai-music-api/add-instrumental') {
    if (uploadUrl) payload.input.upload_url = uploadUrl;
    if (taskId && audioId) {
      payload.input.task_id = taskId;
      payload.input.audio_id = audioId;
    }
    if (title) payload.input.title = title.substring(0, 80);
    const effectiveStyle = style || prompt;
    if (effectiveStyle) {
      payload.input.tags = effectiveStyle.substring(0, 1000);
      payload.input.style = effectiveStyle.substring(0, 1000);
    }
  } else if (operation === 'ai-music-api/cover-generate') {
    // Imagem visual de capa
    payload.input = { task_id: taskId };
  } else if (operation === 'ai-music-api/separate-vocals') {
    // Separação de voz e instrumentos
    if (uploadUrl) payload.input.upload_url = uploadUrl;
    if (taskId && audioId) {
      payload.input.task_id = taskId;
      payload.input.audio_id = audioId;
    }
  }

  const response = await kieFetch(`${KIE_API_BASE}/api/v1/jobs/createTask`, {
    signal: AbortSignal.timeout(30000),
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json();

  if (!response.ok || (data.code && data.code !== 200 && data.code !== 0)) {
    const errorMsg = data.msg || data.message || `Erro na API KIE (HTTP ${response.status})`;
    throw new Error(safeErrorMessage(errorMsg));
  }

  const remoteTaskId = data.data?.taskId || data.taskId;
  if (!remoteTaskId) throw new Error('A KIE não retornou o identificador da música.');
  return {
    taskId: remoteTaskId,
    data: data
  };
}

export function buildSpeechPayload(options = {}) {
  const { customMode = false } = options;
  if (typeof customMode !== 'boolean') throw new Error('Modo de narração inválido.');
  const text = (value, maximum, label, required = true) => {
    if (value != null && typeof value !== 'string') throw new Error(label + ' inválido.');
    const clean = (value || '').trim();
    if ((required && !clean) || clean.length > maximum) throw new Error(label + ' deve ter ' + (required ? 'de 1 a ' : 'até ') + maximum + ' caracteres.');
    return clean;
  };
  const input = { customMode };
  if (!customMode) {
    input.prompt = text(options.prompt, 3000, 'A descrição');
  } else {
    input.script = text(options.script, 5000, 'O roteiro');
    const tone = text(options.tone, 1000, 'A direção de voz', false);
    if (tone) input.tone = tone;
    if (options.variety != null) {
      if (!Number.isInteger(options.variety) || options.variety < 0 || options.variety > 4) throw new Error('A variedade deve ser um inteiro de 0 a 4.');
      input.variety = options.variety;
    }
    if (options.vocalGender) {
      if (typeof options.vocalGender !== 'string' || !['f', 'm'].includes(options.vocalGender.toLowerCase())) throw new Error('Preferência vocal inválida.');
      input.vocalGender = options.vocalGender.toLowerCase();
    }
    if (options.backgroundMusic != null) {
      if (typeof options.backgroundMusic !== 'boolean') throw new Error('Opção de música de fundo inválida.');
      input.backgroundMusic = options.backgroundMusic;
    }
  }
  return { model: 'ai-music-api/speech', input };
}

export async function createSpeechTask(options) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('Cadastre sua chave KIE.AI para criar uma narração.');
  const payload = buildSpeechPayload(options);
  const response = await kieFetch(KIE_API_BASE + '/api/v1/jobs/createTask', {
    method: 'POST', signal: AbortSignal.timeout(30000),
    headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const result = await response.json();
  if (!response.ok || result.code !== 200) throw apiError(result.msg || 'Não foi possível criar a narração.', response.ok ? result.code : response.status);
  if (typeof result.data?.taskId !== 'string' || !result.data.taskId.trim()) throw new Error('A KIE não retornou o identificador da narração.');
  return { taskId: result.data.taskId };
}

export function extractAudioTracks(data) {
  let tracks = data.response?.data;
  if (!Array.isArray(tracks) || !tracks.length) {
    const result = typeof data.resultJson === 'string' ? (data.resultJson.trim() ? JSON.parse(data.resultJson) : {}) : (data.resultJson || {});
    const candidates = [result.response?.data, result.data, result.resultUrls];
    tracks = candidates.find(Array.isArray) || [];
  }
  return tracks.filter(track => typeof track === 'string' || (track && typeof track === 'object')).map((track, index) => typeof track === 'string'
    ? { id: (data.taskId || 'audio') + '_' + index, audio_url: track }
    : { ...track, audio_url: track.audio_url || track.stream_audio_url || track.audioUrl || track.streamAudioUrl, image_url: track.image_url || track.imageUrl })
    .filter(track => typeof track.audio_url === 'string' && /^https:\/\//i.test(track.audio_url));
}

export function saveTaskResults(taskId, tracks) {
  if (!tracks.length) throw new Error('A KIE concluiu a tarefa sem retornar áudios reproduzíveis.');
  const pending = getSavedTracks().find(track => track.id === 'task_' + taskId) || getSavedTracks().find(track => track.taskId === taskId) || {};
  const completed = tracks.map((track, index) => ({
    ...track, id: track.id || taskId + '_' + index, taskId, audioId: track.id,
    variationIndex: index, kind: pending.kind || 'music',
    title: track.title || (pending.title || (pending.kind === 'speech' ? 'Narração' : 'Música')) + (tracks.length > 1 ? ' · versão ' + (index + 1) : ''),
    style: track.style || track.tags || pending.style || '',
    image_url: track.image_url || 'assets/icon.svg',
    status: 'success', createdAt: pending.createdAt || new Date().toISOString(), dateGroup: pending.dateGroup || 'Hoje'
  }));
  // Persist results before removing the pending record, so storage failures remain recoverable.
  for (const track of completed) saveTrack(track);
  removeTrack('task_' + taskId);
  return completed;
}

/**
 * 4. Consultar status do Job (Polling)
 * Endpoint: GET /api/v1/jobs/recordInfo?taskId=...
 */
export async function getTaskDetail(taskId) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('API Key ausente.');

  const response = await kieFetch(`${KIE_API_BASE}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, {
    signal: AbortSignal.timeout(30000),
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    throw apiError(`Falha ao consultar tarefa (HTTP ${response.status}).`, response.status);
  }

  return await response.json();
}

/**
 * 5. Loop de Polling em Background para App Local
 * Trata as 2 faixas retornadas pelo Suno (duas variações)
 */
export function startPollingTask(taskId, { onUpdate, onComplete, onError }) {
  let stopped = false, cancelled = false, timer;
  const deadline = Date.now() + 12 * 60 * 1000;
  async function poll() {
    try {
      if (Date.now() >= deadline) throw new Error('Tempo limite de geração excedido. Consulte o Task ID novamente.');
      const result = await getTaskDetail(taskId);
      if (stopped) return;
      if (result.code != null && ![0, 200].includes(result.code)) throw apiError(result.msg || 'Falha ao consultar geração.', result.code);
      const data = result.data || {};
      const state = String(data.state || '').toLowerCase();
      onUpdate?.({ state, taskId, raw: data });
      if (stopped) return;
      if (state === 'success') {
        const tracks = extractAudioTracks(data);
        if (!tracks.length) throw new Error('A KIE concluiu a tarefa sem retornar áudios reproduzíveis.');
        stopped = true;
        onComplete({ taskId, tracks, raw: data });
        return;
      }
      if (['fail', 'failed'].includes(state)) throw new Error(safeErrorMessage(data.failMsg || data.failReason || 'A geração do áudio falhou.'));
      timer = setTimeout(poll, 4000);
    } catch (err) {
      if (cancelled) return;
      if (stopped) { console.error('[MySuno] Processar resultado:', safeErrorMessage(err)); onError(err); return; }
      console.error('[MySuno] Consultar áudio:', safeErrorMessage(err));
      if ((err.transient || err instanceof TypeError || ['TimeoutError', 'AbortError'].includes(err.name)) && Date.now() < deadline) timer = setTimeout(poll, 4000);
      else { stopped = true; onError(err); }
    }
  }
  timer = setTimeout(poll, 0);
  return () => { stopped = true; cancelled = true; clearTimeout(timer); };
}

/**
 * 6. Upload de Arquivo / Gravação de Áudio para o KIE.AI
 * Retorna a downloadUrl HTTPS pública necessária para Cover / Extensão
 */
export async function uploadAudioFile(fileBlob, fileName = 'audio.mp3') {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('API Key ausente para upload.');

  if (!fileBlob?.size) throw new Error('O arquivo de áudio está vazio.');
  fileName = audioFileName(fileBlob, fileName);
  const directUpload = globalThis.window?.mysuno || globalThis.document?.querySelector('meta[name="mysuno-static"]')?.content === 'true';
  const targets = directUpload ? ['https://kieai.redpandaai.co/api/file-stream-upload'] : ['/api/upload-audio', 'https://kieai.redpandaai.co/api/file-stream-upload'];
  let lastError;
  for (const url of targets) {
    try {
      const formData = new FormData();
      formData.append('file', fileBlob, fileName);
      formData.append('uploadPath', 'audio/covers');
      formData.append('fileName', fileName);
      const response = await kieFetch(url, {
        signal: AbortSignal.timeout(90000), method: 'POST',
        headers: { Authorization: 'Bearer ' + apiKey }, body: formData
      });
      let json;
      try { json = await response.json(); }
      catch { throw apiError('O serviço de upload retornou uma resposta inválida.', response.status); }
      if (!response.ok || (json.code != null && ![0, 200].includes(json.code))) {
        throw apiError(json.msg || json.message || 'Falha ao enviar áudio.', response.ok ? json.code : response.status);
      }
      const downloadUrl = json.data?.downloadUrl || json.downloadUrl || json.data?.filePath;
      if (typeof downloadUrl !== 'string' || !downloadUrl.startsWith('https://')) throw new Error('A KIE não retornou uma URL HTTPS para o áudio.');
      return downloadUrl;
    } catch (err) {
      console.error('[MySuno] Upload de áudio:', safeErrorMessage(err));
      lastError = err;
      if ([401, 403, 413, 422].includes(err.status)) break;
    }
  }
  throw lastError;

}

/**
 * 7. Gerenciamento Local de Vozes Clonadas (Suno Voice Persona)
 */
const STORAGE_KEY_VOICES = 'mysuno_custom_voices';

export function getSavedVoices() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_VOICES);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

export function saveCustomVoice(voice) {
  const voices = getSavedVoices();
  const existingIdx = voices.findIndex(v => v.personaId === voice.personaId || v.id === voice.id);
  if (existingIdx >= 0) {
    voices[existingIdx] = voice;
  } else {
    voices.unshift(voice);
  }
  localStorage.setItem(STORAGE_KEY_VOICES, JSON.stringify(voices));
  return voices;
}

export function removeCustomVoice(personaId) {
  const voices = getSavedVoices().filter(v => v.personaId !== personaId && v.id !== personaId);
  localStorage.setItem(STORAGE_KEY_VOICES, JSON.stringify(voices));
  return voices;
}

/**
 * 8. Suno Voice - Passo 1: Solicitar Frase de Validação (validation-phrase)
 */
export async function createVoiceValidationTask({ voiceUrl, vocalStartS = 0, vocalEndS = 15, language = 'Portuguese' }) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('API Key ausente para gerar frase de validação.');

  const payload = {
    model: 'ai-music-api/validation-phrase',
    input: {
      voice_url: voiceUrl,
      vocal_start_s: parseInt(vocalStartS, 10),
      vocal_end_s: parseInt(vocalEndS, 10),
      language: ({ Portuguese: 'pt', English: 'en', Spanish: 'es' })[language] || language
    }
  };

  const response = await kieFetch(`${KIE_API_BASE}/api/v1/jobs/createTask`, {
    signal: AbortSignal.timeout(30000),
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const json = await response.json();
  if (!response.ok || (json.code && json.code !== 200)) {
    throw new Error(safeErrorMessage(json.msg || 'Falha ao solicitar frase de validação.'));
  }

  return json.data; // { taskId: '...' }
}

/**
 * Polling para aguardar a frase de validação gerada pela API Suno
 */
export function pollVoiceTask(taskId, { onReady, onError, phraseOnly = false }) {
  let cancelled = false, timer;
  const deadline = Date.now() + 300000;
  async function poll() {
    try {
      if (Date.now() >= deadline) { const error = new Error('Tempo limite da verificação de voz. Retome a consulta para conferir o resultado.'); error.resumable = true; throw error; }
      const result = await getTaskDetail(taskId);
      if (cancelled) return;
      if (result.code != null && ![0, 200].includes(result.code)) throw apiError(result.msg || 'Falha ao consultar a voz.', result.code);
      const data = result.data || {};
      const state = String(data.state || data.status || '').toLowerCase();
      if (['fail', 'failed', 'processing_validate_fail'].includes(state)) { const error = new Error(data.failReason || data.failMsg || data.errorMessage || 'A verificação da voz falhou.'); error.terminal = true; throw error; }
      if (phraseOnly) {
        const parsed = typeof data.resultJson === 'string' ? JSON.parse(data.resultJson) : (data.resultJson || {});
        const phrase = data.validateInfo || data.validationPhrase || data.phrase || parsed.validateInfo || parsed.validationPhrase || parsed.phrase || parsed.text;
        if (typeof phrase === 'string' && phrase.trim()) { onReady(phrase.trim()); return; }
        if (state === 'success') throw new Error('A KIE não retornou a frase. Inicie uma nova validação.');
      } else if (state === 'success' && await checkVoiceAvailability(taskId)) {
        if (!cancelled) onReady(taskId);
        return;
      }
      if (!cancelled) timer = setTimeout(poll, 3000);
    } catch (err) {
      if (!cancelled) {
        console.error('[MySuno] Verificação de voz:', safeErrorMessage(err));
        if ((err.transient || err instanceof TypeError || ['TimeoutError', 'AbortError'].includes(err.name)) && Date.now() < deadline) {
          timer = setTimeout(poll, 3000);
        } else { onError(err); }
      }
    }
  }
  poll();
  return () => { cancelled = true; clearTimeout(timer); };
}
export function pollVoiceValidationPhrase(taskId, { onPhraseReady, onError }) {
  return pollVoiceTask(taskId, { onReady: onPhraseReady, onError, phraseOnly: true });
}
export function waitForVoiceReady(taskId) {
  return new Promise((resolve, reject) => pollVoiceTask(taskId, { onReady: resolve, onError: reject }));
}

/**
 * 9. Suno Voice - Passo 2: Criar Voz Personalizada (create-voice)
 * Conforme OpenAPI Specification fornecida pelo usuário!
 */
export async function createCustomVoiceTask({
  taskId,
  verifyUrl,
  voiceName,
  description = '',
  style = '',
  singerSkillLevel = 'beginner'
}) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('API Key ausente para criar voz personalizada.');

  const payload = {
    model: 'ai-music-api/create-voice',
    input: {
      task_id: taskId,
      verify_url: verifyUrl,
      voice_name: voiceName,
      description: description,
      style: style,
      singer_skill_level: singerSkillLevel
    }
  };

  const response = await kieFetch(`${KIE_API_BASE}/api/v1/jobs/createTask`, {
    signal: AbortSignal.timeout(30000),
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const json = await response.json();
  if (!response.ok || (json.code && json.code !== 200)) {
    throw apiError(json.msg || 'Falha ao registrar voz personalizada.', response.ok ? json.code : response.status);
  }

  return json.data;
}

/**
 * 10. Suno Voice - Verificar Disponibilidade da Voz (check-voice)
 * Endpoint síncrono e gratuito que retorna se a voz está pronta para cantar
 */
export async function checkVoiceAvailability(taskId) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('API Key ausente.');

  const payload = {
    model: 'ai-music-api/check-voice',
    input: {
      task_id: taskId
    }
  };

  const response = await kieFetch(`${KIE_API_BASE}/api/v1/jobs/createTask`, {
    signal: AbortSignal.timeout(30000),
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const json = await response.json();
  if (!response.ok || (json.code && json.code !== 200)) {
    throw apiError(json.msg || 'Falha ao consultar disponibilidade da voz.', response.ok ? json.code : response.status);
  }

  if (typeof json.data?.isAvailable !== 'boolean') throw new Error('Resposta de disponibilidade da voz inválida.');
  return json.data.isAvailable;
}

export function audioFileName(blob, name = 'audio') {
  const mime = (blob.type || '').split(';')[0].toLowerCase();
  const ext = { 'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/mpeg': 'mp3' }[mime];
  return ext ? name.replace(/\.[^.]+$/, '') + '.' + ext : name;
}
