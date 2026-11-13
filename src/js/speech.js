import { createSpeechTask, hasApiKey, saveTrack, safeErrorMessage } from './api.js';

export function initSpeech({ notify, onTaskCreated }) {
  const form = document.getElementById('speech-form');
  if (!form) return;
  const field = id => document.getElementById(id);
  const music = field('music-form');
  const musicTab = field('kind-music');
  const speechTab = field('kind-speech');
  const mode = field('speech-mode');
  const text = field('speech-text');
  const submit = field('speech-submit');
  let submitting = false;
  let currentMode = mode.value;
  const drafts = { simple: '', advanced: '' };

  function selectKind(kind) {
    const speech = kind === 'speech';
    music.hidden = speech;
    form.hidden = !speech;
    musicTab.setAttribute('aria-selected', String(!speech));
    speechTab.setAttribute('aria-selected', String(speech));
    musicTab.tabIndex = speech ? -1 : 0;
    speechTab.tabIndex = speech ? 0 : -1;
    field('creation-heading').textContent = speech ? 'Criar Narração' : 'Criar Nova Música';
    field('model-select').closest('.model-select-wrap').hidden = speech;
  }
  for (const [tab, kind] of [[musicTab, 'music'], [speechTab, 'speech']]) {
    tab.addEventListener('click', () => selectKind(kind));
    tab.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const target = event.key === 'Home' ? musicTab : event.key === 'End' ? speechTab : tab === musicTab ? speechTab : musicTab;
      target.click(); target.focus();
    });
  }
  function updateMode() {
    const advanced = mode.value === 'advanced';
    field('speech-advanced').hidden = !advanced;
    text.maxLength = advanced ? 5000 : 3000;
    field('speech-text-label').textContent = advanced ? 'Roteiro que será narrado' : 'Descreva a cena';
    text.placeholder = advanced ? 'Olá! Seja bem-vindo ao nosso podcast. Hoje vamos conversar sobre...' : 'Uma abertura de podcast em português brasileiro, acolhedora e animada.';
    updateCounts();
  }
  function updateCounts() {
    field('speech-text-count').textContent = text.value.length + ' / ' + text.maxLength;
    field('speech-tone-count').textContent = field('speech-tone').value.length + ' / 1000';
  }
  mode.addEventListener('change', () => {
    drafts[currentMode] = text.value;
    currentMode = mode.value;
    text.value = drafts[currentMode];
    updateMode();
  });
  text.addEventListener('input', updateCounts);
  field('speech-tone').addEventListener('input', updateCounts);
  window.addEventListener('mysuno:before-update', event => { if (submitting) event.preventDefault(); });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (submitting) return;
    if (!hasApiKey()) {
      field('settings-modal').classList.add('active');
      notify('Cadastre sua chave KIE.AI antes de criar uma narração.', 'error');
      return;
    }
    const advanced = mode.value === 'advanced';
    const options = advanced ? {
      customMode: true, script: text.value, tone: field('speech-tone').value,
      variety: Number(field('speech-variety').value), vocalGender: field('speech-gender').value,
      backgroundMusic: field('speech-background').checked
    } : { customMode: false, prompt: text.value };
    const title = field('speech-title').value.trim() || 'Narração Suno Speech';
    const controls = [...form.querySelectorAll('input, textarea, select, button')];
    submitting = true;
    controls.forEach(control => { control.disabled = true; });
    submit.textContent = 'Enviando narração...';
    let submittedTask;
    try {
      const { taskId } = await createSpeechTask(options);
      submittedTask = taskId;
      saveTrack({
        id: 'task_' + taskId, taskId, kind: 'speech', title,
        style: advanced ? options.tone.trim() || 'Narração personalizada' : 'Narração · ' + options.prompt.trim().slice(0, 120),
        status: 'generating', duration: 'Gerando...', dateGroup: 'Hoje',
        createdAt: new Date().toISOString(), image_url: 'assets/icon.svg'
      });
      onTaskCreated(taskId);
      notify('Narração solicitada! Acompanhe as duas versões na biblioteca.', 'success');
    } catch (error) {
      const message = safeErrorMessage(error);
      console.error('[MySuno] Narração:', message);
      notify(submittedTask ? 'Pedido criado (' + submittedTask + '), mas houve uma falha local. Importe esse Task ID para acompanhar: ' + message : 'Não foi possível solicitar a narração: ' + message, 'error');
    } finally {
      submitting = false;
      controls.forEach(control => { control.disabled = false; });
      submit.textContent = 'Criar Narração';
    }
  });
  updateMode();
}
