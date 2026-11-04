import { initMusicModels, getSelectedMusicModel } from './models.js';
/**
 * MySuno — Main Application Controller
 */

import {
  getApiKey,
  safeErrorMessage,
  saveApiKey,
  hasApiKey,
  testApiKeyConnection,
  getSavedTracks,
  saveTrack,
  removeTrack,
  createMusicTask,
  startPollingTask,
  getTaskDetail,
  uploadAudioFile,
  getSavedVoices,
  saveCustomVoice,
  removeCustomVoice,
  createVoiceValidationTask,
  pollVoiceValidationPhrase,
  createCustomVoiceTask,
  checkVoiceAvailability,
  waitForVoiceReady,
  audioFileName
} from './api.js';

import { player } from './player.js';

// 0. Modern Toast & Confirm System (Substitui alerts e prompts nativos feios)
export function showToast(message, type = 'info') {
  message = safeErrorMessage(message);
  if (type === 'error') console.error('[MySuno]', message);
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast-item ${type}`;

  const iconSvg = type === 'success'
    ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`
    : type === 'error'
    ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>`
    : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--primary-orange)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`;

  toast.innerHTML = `<span style="display:inline-flex; align-items:center;">${iconSvg}</span><span>${escapeHtml(message)}</span>`;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'toastOut 0.25s ease-in forwards';
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 250);
  }, 3500);
}

let currentConfirmCallback = null;
export function showConfirm(title, message, onConfirm) {
  const modal = document.getElementById('confirm-modal');
  const titleEl = document.getElementById('confirm-modal-title');
  const msgEl = document.getElementById('confirm-modal-message');
  const btnConfirm = document.getElementById('confirm-modal-confirm');
  const btnCancel = document.getElementById('confirm-modal-cancel');

  if (!modal) return;

  titleEl.textContent = title;
  msgEl.textContent = message;
  currentConfirmCallback = onConfirm;

  modal.classList.add('active');

  btnConfirm.onclick = () => {
    modal.classList.remove('active');
    if (currentConfirmCallback) currentConfirmCallback();
  };

  btnCancel.onclick = () => {
    modal.classList.remove('active');
  };
}

window.addEventListener('mysuno:before-update', event => {
  if (activeTasksPolling.size || mediaRecorder?.state === 'recording' || cloneMediaRecorder?.state === 'recording' || document.getElementById('btn-create-submit')?.disabled) event.preventDefault();
});

window.addEventListener('error', event => console.error('[MySuno] Erro não tratado:', safeErrorMessage(event.message)));
window.addEventListener('unhandledrejection', event => console.error('[MySuno] Promise rejeitada:', safeErrorMessage(event.reason?.message || 'Erro assíncrono sem mensagem.')));

// State
let currentTab = 'songs';
let customMode = false;
let currentFilter = 'all';
let searchQuery = '';
let activeTasksPolling = new Map();
let selectedTrackForMenu = null;

// Audio Source State (Cover & Extensão via Upload / Microfone / URL)
let selectedAudioBlob = null;
let selectedAudioName = '';
let activeAudioSourceTab = 'upload';
let mediaRecorder = null;
let audioStream = null;
let recordedChunks = [];
let recordingStartTime = 0;
let recordingTimerId = null;

// Suno Voice Persona State (Clonagem de Voz)
let selectedCustomVoicePersonaId = null;
let selectedCustomVoiceName = null;
let cloneStep = 1;
let cloneSampleBlob = null;
let cloneSampleName = '';
let cloneVerifyBlob = null;
let cloneValidationTaskId = null;
let cloneMediaRecorder = null;
let cloneAudioStream = null;

// Waveform Visualizer Instances (Animação de Áudio estilo Studio)
let micWaveVisualizer = null;
let cloneSampleVisualizer = null;
let cloneVerifyVisualizer = null;

document.addEventListener('DOMContentLoaded', () => {
  initUI();
  initMusicModels();
  updateApiStatus();
  renderTracksFeed();

  const tracks = getSavedTracks();
  for (const track of tracks) {
    if (track.taskId && ['waiting', 'queuing', 'generating', 'pending'].includes(track.status)) pollMusicProgress(track.taskId);
  }
  if (tracks.length > 0 && tracks[0].audio_url) {
    player.loadTrack(tracks[0], false);
  }
});

function initUI() {
  // 1. Settings Modal & API Key
  const btnApiSettings = document.getElementById('btn-api-settings');
  const settingsModal = document.getElementById('settings-modal');
  const settingsCloseBtn = document.getElementById('settings-close-btn');
  const settingsSaveBtn = document.getElementById('settings-save-btn');
  const apiKeyInput = document.getElementById('api-key-input');
  const btnTestKey = document.getElementById('btn-test-key');
  const testKeyResult = document.getElementById('test-key-result');

  btnApiSettings.addEventListener('click', () => {
    apiKeyInput.value = getApiKey();
    testKeyResult.textContent = '';
    settingsModal.classList.add('active');
  });

  settingsCloseBtn.addEventListener('click', () => {
    settingsModal.classList.remove('active');
  });

  settingsSaveBtn.addEventListener('click', () => {
    saveApiKey(apiKeyInput.value);
    updateApiStatus();
    settingsModal.classList.remove('active');
    showToast('Chave KIE.AI salva localmente!', 'success');
  });

  btnTestKey.addEventListener('click', async () => {
    testKeyResult.style.color = '#f59e0b';
    testKeyResult.textContent = 'Testando conexão...';
    try {
      await testApiKeyConnection(apiKeyInput.value);
      testKeyResult.style.color = '#10b981';
      testKeyResult.innerHTML = '<span style="display:inline-flex; align-items:center; gap:5px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"></path></svg> Conexão Autorizada com KIE.AI!</span>';
    } catch (err) {
      console.error('[MySuno] Testar chave:', safeErrorMessage(err));
      testKeyResult.style.color = '#ef4444';
      testKeyResult.innerHTML = `<span style="display:inline-flex; align-items:center; gap:5px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg> ${escapeHtml(safeErrorMessage(err))}</span>`;
    }
  });

  // 2. Navigation items (Criar Música vs Minha Biblioteca)
  const appContainer = document.querySelector('.app-container');
  const btnNavCreate = document.querySelector('.create-pill-btn[data-page="create"]');
  const btnNavLibrary = document.getElementById('nav-btn-library');
  const btnTopbarCreate = document.getElementById('btn-topbar-create');

  function setAppView(page) {
    if (page === 'library') {
      if (appContainer) appContainer.classList.add('view-library');
      if (btnNavLibrary) btnNavLibrary.classList.add('active');
      if (btnNavCreate) btnNavCreate.classList.remove('active');
      renderTracksFeed();
    } else {
      if (appContainer) appContainer.classList.remove('view-library');
      if (btnNavCreate) btnNavCreate.classList.add('active');
      if (btnNavLibrary) btnNavLibrary.classList.remove('active');
    }
  }

  if (btnNavCreate) {
    btnNavCreate.addEventListener('click', () => setAppView('create'));
  }
  if (btnNavLibrary) {
    btnNavLibrary.addEventListener('click', () => setAppView('library'));
  }
  if (btnTopbarCreate) {
    btnTopbarCreate.addEventListener('click', () => setAppView('create'));
  }

  // 3. Tab Pills (Songs / Speech)
  const tabPills = document.querySelectorAll('.tab-main-pill');
  tabPills.forEach(pill => {
    pill.addEventListener('click', () => {
      tabPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      currentTab = pill.dataset.tab;
    });
  });

  // 4. Mode Switcher (Simple vs Advanced)
  const modeBtns = document.querySelectorAll('.mode-pill');
  const advancedFields = document.getElementById('advanced-fields');
  const promptInput = document.getElementById('prompt-input');

  modeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      modeBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      customMode = btn.dataset.mode === 'advanced';

      if (customMode) {
        advancedFields.style.display = 'flex';
        promptInput.placeholder = '[Verse 1]\nEscreva sua letra aqui...\n\n[Chorus]\nRefrão marcante...';
      } else {
        advancedFields.style.display = 'none';
        promptInput.placeholder = 'Trap rap instrumental em português mais rápido, com hi-hats corridos, 808 firme e piano incisivo.';
      }
    });
  });

  // 5. Action Chips (+ Audio, + Voice)
  const chipAudio = document.getElementById('chip-audio');
  const audioDrawer = document.getElementById('audio-drawer');
  if (chipAudio && audioDrawer) {
    chipAudio.addEventListener('click', () => {
      chipAudio.classList.toggle('active');
      audioDrawer.style.display = chipAudio.classList.contains('active') ? 'flex' : 'none';
    });
  }

  // 5. Preferência Vocal (Modal Elegante)
  const chipVoice = document.getElementById('chip-voice');
  const vocalModal = document.getElementById('vocal-modal');
  const vocalOptions = document.querySelectorAll('.vocal-card-option');
  let selectedGender = 'female';

  if (chipVoice && vocalModal) {
    chipVoice.addEventListener('click', () => {
      renderClonedVoicesList();
      vocalModal.classList.add('active');
    });

    vocalOptions.forEach(opt => {
      opt.addEventListener('click', () => {
        vocalOptions.forEach(o => o.classList.remove('active'));
        opt.classList.add('active');
        selectedGender = opt.dataset.gender;
        // Limpar seleção de voz customizada
        selectedCustomVoicePersonaId = null;
        selectedCustomVoiceName = null;
        renderClonedVoicesList();
      });
    });

    const btnSaveVocal = document.getElementById('btn-save-vocal');
    if (btnSaveVocal) {
      btnSaveVocal.addEventListener('click', () => {
        vocalModal.classList.remove('active');
        if (selectedCustomVoicePersonaId && selectedCustomVoiceName) {
          chipVoice.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px;"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg><span>${escapeHtml(selectedCustomVoiceName)}</span>`;
          chipVoice.classList.add('active');
          showToast(`Voz clonada ativa para criação: ${selectedCustomVoiceName}`, 'success');
        } else if (selectedGender !== 'auto') {
          promptInput.value = `${promptInput.value} [Vocal: ${selectedGender}]`.trim();
          const vocalSvg = selectedGender === 'female'
            ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px;"><path d="M12 2a5 5 0 0 1 5 5v3a5 5 0 0 1-10 0V7a5 5 0 0 1 5-5z"></path><path d="M20 21a8 8 0 0 0-16 0"></path></svg>`
            : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px;"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>`;
          chipVoice.innerHTML = `${vocalSvg}<span>${selectedGender === 'female' ? 'Voz Feminina' : 'Voz Masculina'}</span>`;
          chipVoice.classList.add('active');
          showToast(`Preferência aplicada: ${selectedGender === 'female' ? 'Voz Feminina' : 'Voz Masculina'}`, 'success');
        } else {
          chipVoice.innerHTML = `<span>+</span> Preferência Vocal`;
          chipVoice.classList.remove('active');
          showToast('Vocais em modo automático pelo estilo musical.', 'info');
        }
      });
    }
  }

  // 6. Seções Musicais (Modal de 1 Clique)
  const btnAddSection = document.getElementById('btn-add-section');
  const sectionModal = document.getElementById('section-modal');
  const sectionChips = document.querySelectorAll('.section-chip-btn');

  if (btnAddSection && sectionModal && promptInput) {
    btnAddSection.addEventListener('click', () => {
      sectionModal.classList.add('active');
    });

    sectionChips.forEach(btn => {
      btn.addEventListener('click', () => {
        const tag = btn.dataset.tag;
        sectionModal.classList.remove('active');
        if (tag) {
          const curVal = promptInput.value;
          promptInput.value = curVal ? `${curVal}\n\n${tag}\n` : `${tag}\n`;
          promptInput.focus();
          showToast(`Seção ${tag} adicionada!`, 'info');
        }
      });
    });
  }

  // 7. Quick Style Chips
  const styleChips = document.querySelectorAll('.style-chip');
  const styleInput = document.getElementById('style-input');
  styleChips.forEach(chip => {
    chip.addEventListener('click', () => {
      const tag = chip.textContent.replace('+', '').trim();
      if (customMode) {
        styleInput.value = styleInput.value ? `${styleInput.value}, ${tag}` : tag;
        updateCharCounts();
      } else {
        promptInput.value = promptInput.value ? `${promptInput.value}, ${tag}` : tag;
      }
    });
  });

  // 8. Character Counters
  const titleInput = document.getElementById('title-input');
  titleInput.addEventListener('input', updateCharCounts);
  if (styleInput) styleInput.addEventListener('input', updateCharCounts);

  // 9. Search Input
  const searchInput = document.getElementById('search-input');
  searchInput.addEventListener('input', (e) => {
    searchQuery = e.target.value.toLowerCase();
    renderTracksFeed();
  });

  // 10. Filter Pills
  const filterPills = document.querySelectorAll('.filter-pill-btn[data-filter]');
  filterPills.forEach(pill => {
    pill.addEventListener('click', () => {
      filterPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      currentFilter = pill.dataset.filter;
      renderTracksFeed();
    });
  });

  // 11. Create Button
  const btnCreate = document.getElementById('btn-create-submit');
  btnCreate.addEventListener('click', handleCreateMusic);

  // 12. Gaveta de Áudio (Upload / Microfone / URL)
  initAudioDrawer();

  // 13. Modal de Ações da Faixa
  initTrackMenuModal();

  // 14. Assistente de Clonagem de Voz (Suno Voice Persona)
  initVoiceCloneWizard();

  // 15. Modal de Importação por Task ID do KIE.AI
  initImportTaskModal();

  // 16. Highlight playing card
  window.addEventListener('player:play', (e) => highlightPlayingCard(e.detail?.id));
  window.addEventListener('player:pause', () => highlightPlayingCard(null));
}

function initAudioDrawer() {
  const tabBtns = document.querySelectorAll('.audio-tab-btn[data-src-tab]');
  const tabUpload = document.getElementById('tab-content-upload');
  const tabMic = document.getElementById('tab-content-mic');
  const tabUrl = document.getElementById('tab-content-url');

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeAudioSourceTab = btn.dataset.srcTab;

      if (tabUpload) tabUpload.style.display = activeAudioSourceTab === 'upload' ? 'block' : 'none';
      if (tabMic) tabMic.style.display = activeAudioSourceTab === 'mic' ? 'block' : 'none';
      if (tabUrl) tabUrl.style.display = activeAudioSourceTab === 'url' ? 'block' : 'none';
    });
  });

  // Upload por Arquivo e Drag & Drop
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('audio-file-input');

  if (dropZone && fileInput) {
    dropZone.addEventListener('click', (e) => {
      if (e.target !== fileInput) fileInput.click();
    });

    ['dragenter', 'dragover'].forEach(name => {
      dropZone.addEventListener(name, (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
      });
    });

    ['dragleave', 'drop'].forEach(name => {
      dropZone.addEventListener(name, (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
      });
    });

    dropZone.addEventListener('drop', (e) => {
      if (e.dataTransfer?.files?.length > 0) {
        handleAudioFileSelected(e.dataTransfer.files[0]);
      }
    });

    fileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        handleAudioFileSelected(e.target.files[0]);
      }
    });
  }

  // Gravação por Microfone
  const btnToggleRecord = document.getElementById('btn-toggle-record');
  if (btnToggleRecord) {
    btnToggleRecord.addEventListener('click', toggleMicrophoneRecording);
  }

  // Botão remover áudio selecionado
  const btnRemoveAudio = document.getElementById('btn-remove-selected-audio');
  if (btnRemoveAudio) {
    btnRemoveAudio.addEventListener('click', clearSelectedAudio);
  }
}

function handleAudioFileSelected(file) {
  if (!file.type.startsWith('audio/') && !file.name.match(/\.(mp3|wav|ogg|m4a|aac|flac)$/i)) {
    showToast('Por favor, selecione um arquivo de áudio válido (MP3, WAV, M4A, etc.)', 'error');
    return;
  }

  if (file.size > 50 * 1024 * 1024) {
    showToast('O arquivo deve ter no máximo 50MB (ou 8 minutos).', 'error');
    return;
  }

  selectedAudioBlob = file;
  selectedAudioName = file.name;

  const previewWrap = document.getElementById('audio-preview-wrap');
  const previewAudio = document.getElementById('audio-local-preview');
  const previewName = document.getElementById('audio-preview-name');
  const uploadZoneText = document.getElementById('upload-zone-text');

  if (previewAudio) previewAudio.src = URL.createObjectURL(file);
  if (previewName) previewName.textContent = `${file.name} (${(file.size / (1024 * 1024)).toFixed(1)} MB)`;
  if (previewWrap) previewWrap.style.display = 'block';
  if (uploadZoneText) uploadZoneText.textContent = `Arquivo carregado: ${file.name}`;

  showToast(`Áudio selecionado: ${file.name}`, 'success');
}

async function toggleMicrophoneRecording() {
  const btn = document.getElementById('btn-toggle-record');
  const btnText = document.getElementById('record-btn-text');
  const timerEl = document.getElementById('record-timer');

  if (mediaRecorder && mediaRecorder.state === 'recording') {
    // Parar gravação e animação
    if (micWaveVisualizer) micWaveVisualizer.stop();
    const waveBox = document.getElementById('mic-waveform-box');
    if (waveBox) waveBox.style.display = 'none';

    mediaRecorder.stop();
    if (audioStream) {
      audioStream.getTracks().forEach(track => track.stop());
      audioStream = null;
    }
    if (recordingTimerId) {
      clearInterval(recordingTimerId);
      recordingTimerId = null;
    }
    btn.classList.remove('recording');
    btnText.textContent = 'Gravar Novamente';
    return;
  }

  // Iniciar nova gravação
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Navegador não suporta gravação direta de microfone.');
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioStream = stream;
    recordedChunks = [];

    let mimeType = 'audio/webm';
    if (!MediaRecorder.isTypeSupported('audio/webm')) {
      mimeType = MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '';
    }

    mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);

    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        recordedChunks.push(e.data);
      }
    };

    const recorder = mediaRecorder;
    monitorRecorder(recorder, stream, () => {
      clearInterval(recordingTimerId);
      micWaveVisualizer?.stop();
      btn.classList.remove('recording');
      btnText.textContent = 'Gravar Novamente';
      selectedAudioBlob = null;
      document.getElementById('mic-waveform-box').style.display = 'none';
    });
    mediaRecorder.onstop = () => {
      clearInterval(recordingTimerId);
      stream.getTracks().forEach(track => track.stop());
      if (failedRecorders.has(recorder)) return;
      if (!recordedChunks.length) { showToast('A gravação ficou vazia. Grave novamente.', 'error'); return; }
      const audioBlob = new Blob(recordedChunks, { type: recordedChunks[0]?.type || mediaRecorder.mimeType || mimeType });
      selectedAudioBlob = audioBlob;
      selectedAudioName = audioFileName(audioBlob, `gravacao_mic_${Date.now()}`);

      const previewWrap = document.getElementById('audio-preview-wrap');
      const previewAudio = document.getElementById('audio-local-preview');
      const previewName = document.getElementById('audio-preview-name');

      if (previewAudio) previewAudio.src = URL.createObjectURL(audioBlob);
      if (previewName) {
        const dur = Math.round((Date.now() - recordingStartTime) / 1000);
        previewName.textContent = `Gravação do Microfone (${formatDuration(dur)})`;
      }
      if (previewWrap) previewWrap.style.display = 'block';

      showToast('Gravação concluída! Prévia pronta para criar a música.', 'success');
    };

    mediaRecorder.start(200);
    recordingStartTime = Date.now();
    btn.classList.add('recording');
    btnText.textContent = 'Parar Gravação';
    timerEl.textContent = '00:00';

    // Iniciar animação waveform de áudio ao vivo (estilo do print)
    const waveBox = document.getElementById('mic-waveform-box');
    const waveCanvas = document.getElementById('mic-waveform-canvas');
    if (waveBox && waveCanvas) {
      waveBox.style.display = 'flex';
      if (!micWaveVisualizer) micWaveVisualizer = new WaveformVisualizer(waveCanvas);
      micWaveVisualizer.start(stream);
    }

    recordingTimerId = setInterval(() => {
      const elapsedSec = Math.floor((Date.now() - recordingStartTime) / 1000);
      timerEl.textContent = formatDuration(elapsedSec);
      if (elapsedSec >= 480) { // Máximo de 8 minutos permitido pelo Suno
        toggleMicrophoneRecording();
        showToast('Tempo limite de 8 minutos atingido.', 'info');
      }
    }, 1000);

    showToast('Gravando... Pode cantar, assobiar ou tocar um instrumento!', 'info');
  } catch (err) {
    audioStream?.getTracks().forEach(track => track.stop());
    showToast(`Erro ao acessar microfone: ${err.message}`, 'error');
  }
}

function clearSelectedAudio() {
  if (micWaveVisualizer) micWaveVisualizer.stop();
  const waveBox = document.getElementById('mic-waveform-box');
  if (waveBox) waveBox.style.display = 'none';

  selectedAudioBlob = null;
  selectedAudioName = '';

  const previewWrap = document.getElementById('audio-preview-wrap');
  const previewAudio = document.getElementById('audio-local-preview');
  const fileInput = document.getElementById('audio-file-input');
  const urlInput = document.getElementById('upload-url-input');
  const uploadZoneText = document.getElementById('upload-zone-text');
  const btnRecord = document.getElementById('btn-toggle-record');
  const recordText = document.getElementById('record-btn-text');

  if (previewAudio) {
    previewAudio.pause();
    previewAudio.src = '';
  }
  if (previewWrap) previewWrap.style.display = 'none';
  if (fileInput) fileInput.value = '';
  if (urlInput) urlInput.value = '';
  if (uploadZoneText) uploadZoneText.textContent = 'Clique ou arraste um áudio (MP3, WAV, M4A)';
  if (btnRecord) btnRecord.classList.remove('recording');
  if (recordText) recordText.textContent = 'Gravar Microfone';

  showToast('Áudio de referência removido.', 'info');
}

function updateCharCounts() {
  const titleInput = document.getElementById('title-input');
  const styleInput = document.getElementById('style-input');
  const titleCounter = document.getElementById('title-char-count');
  const styleCounter = document.getElementById('style-char-count');

  if (titleInput && titleCounter) titleCounter.textContent = `${titleInput.value.length} / 80`;
  if (styleInput && styleCounter) styleCounter.textContent = `${styleInput.value.length} / 1000`;
}

function updateApiStatus() {
  const isConnected = hasApiKey();
  const dot = document.getElementById('api-status-dot');
  const text = document.getElementById('api-status-text');

  if (isConnected) {
    dot.classList.add('connected');
    text.textContent = 'KIE.AI Conectada';
  } else {
    dot.classList.remove('connected');
    text.textContent = 'Cadastrar Chave KIE';
  }
}

async function handleCreateMusic() {
  if (!hasApiKey()) {
    document.getElementById('settings-modal').classList.add('active');
    showToast('Por favor, cadastre sua chave do KIE.AI primeiro!', 'error');
    return;
  }

  let modelSelect;
  const instrumental = document.getElementById('instrumental-check').checked;
  const promptValue = document.getElementById('prompt-input').value.trim();
  const titleValue = document.getElementById('title-input')?.value.trim() || '';
  const styleValue = document.getElementById('style-input')?.value.trim() || '';
  const directUrlValue = document.getElementById('upload-url-input')?.value.trim() || '';
  const audioMode = document.querySelector('input[name="audio-mode"]:checked')?.value || 'cover';

  const btnCreate = document.getElementById('btn-create-submit');
  btnCreate.disabled = true;
  btnCreate.innerHTML = `
    <div class="wave-container" style="display:inline-flex;">
      <div class="wave-bar"></div>
      <div class="wave-bar"></div>
      <div class="wave-bar"></div>
    </div>
    <span>Criando Música...</span>
  `;

  try {
    modelSelect = await getSelectedMusicModel();
    if (selectedCustomVoicePersonaId) {
      if (instrumental) throw new Error('Desative Instrumental para usar sua voz.');
      if (!await checkVoiceAvailability(selectedCustomVoicePersonaId)) throw new Error('Sua voz ainda não está disponível na KIE.');
    }
    let finalUploadUrl = directUrlValue;

    // Se o usuário selecionou um arquivo local ou gravou pelo microfone
    if (selectedAudioBlob) {
      showToast('Enviando áudio para o servidor KIE.AI...', 'info');
      finalUploadUrl = await uploadAudioFile(selectedAudioBlob, selectedAudioName || 'meu-audio.mp3');
      showToast('Áudio enviado com sucesso! Produzindo no Suno...', 'success');
    }

    let operation = 'ai-music-api/generate';
    if (finalUploadUrl) {
      if (audioMode === 'instrumental') {
        operation = 'ai-music-api/add-instrumental';
      } else if (audioMode === 'extend') {
        operation = 'ai-music-api/upload-and-extend-audio';
      } else {
        operation = 'ai-music-api/upload-and-cover-audio';
      }
    }

    const taskResult = await createMusicTask({
      operation: operation,
      model: modelSelect,
      customMode: customMode,
      instrumental: instrumental,
      title: titleValue || (customMode ? 'Untitled' : (promptValue ? promptValue.slice(0, 30) : 'Cover Suno V6')),
      style: styleValue,
      lyrics: customMode ? promptValue : '',
      prompt: promptValue,
      uploadUrl: finalUploadUrl,
      personaId: selectedCustomVoicePersonaId || undefined,
      personaModel: selectedCustomVoicePersonaId ? 'voice_persona' : undefined
    });

    const taskId = taskResult.taskId;

    // Criar placeholder no feed local (Suno normalmente cria 2 variações)
    const tempTrack = {
      id: `task_${taskId}`,
      taskId: taskId,
      dateGroup: 'Hoje',
      title: titleValue || (customMode ? 'Untitled Track' : (promptValue ? promptValue.slice(0, 35) : 'Cover Suno V6')),
      style: styleValue || (instrumental ? 'Instrumental' : promptValue || 'Cover de Áudio'),
      status: 'generating',
      duration: 'Gerando...',
      createdAt: new Date().toISOString(),
      image_url: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=200&auto=format&fit=crop&q=80'
    };

    saveTrack(tempTrack);
    renderTracksFeed();

    // Iniciar loop de polling
    pollMusicProgress(taskId);

    // Resetar formulário
    document.getElementById('prompt-input').value = '';
    if (document.getElementById('title-input')) document.getElementById('title-input').value = '';
    updateCharCounts();
  } catch (err) {
    showToast(`Erro ao criar música: ${err.message}`, 'error');
  } finally {
    btnCreate.disabled = false;
    btnCreate.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
      </svg>
      <span>Criar Música</span>
    `;
  }
}

function pollMusicProgress(taskId) {
  if (activeTasksPolling.has(taskId)) return;

  const cancelFn = startPollingTask(taskId, {
    onUpdate: ({ state }) => {
      const track = getSavedTracks().find(t => t.taskId === taskId);
      if (track && track.status !== state) {
        track.status = state;
        saveTrack(track);
        renderTracksFeed();
      }
    },
    onComplete: ({ tracks }) => {
      activeTasksPolling.delete(taskId);
      removeTrack(`task_${taskId}`);

      if (tracks && tracks.length > 0) {
        tracks.forEach((t, index) => {
          const newTrack = {
            id: t.id || `track_${Date.now()}_${index}`,
            taskId: taskId,
            audioId: t.id,
            variationIndex: index,
            dateGroup: 'Hoje',
            title: t.title || 'Faixa Suno V6',
            style: t.style || t.prompt || 'Música Suno V6',
            audio_url: t.audio_url || t.stream_audio_url,
            image_url: t.image_url || 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=200&auto=format&fit=crop&q=80',
            duration: t.duration ? formatDuration(t.duration) : '2:30',
            hasExtendPill: true,
            status: 'success',
            createdAt: new Date().toISOString()
          };
          saveTrack(newTrack);
        });

        // Carrega a primeira variação no player automaticamente
        player.loadTrack(tracks[0], true);
      }
      renderTracksFeed();
    },
    onError: (err) => {
      activeTasksPolling.delete(taskId);
      const track = getSavedTracks().find(t => t.taskId === taskId);
      console.error('[MySuno] Geração musical:', err.message);
      if (track) {
        track.status = 'fail';
        track.errorMessage = err.message;
        saveTrack(track);
      }
      renderTracksFeed();
    }
  });

  activeTasksPolling.set(taskId, cancelFn);
}

function renderTracksFeed() {
  const container = document.getElementById('feed-container');
  if (!container) return;

  const allSaved = getSavedTracks();
  const countBadge = document.getElementById('library-count-badge');
  if (countBadge) {
    countBadge.textContent = `${allSaved.length} ${allSaved.length === 1 ? 'faixa' : 'faixas'}`;
  }

  let tracks = allSaved;

  // Filtros
  if (searchQuery) {
    tracks = tracks.filter(t => 
      (t.title && t.title.toLowerCase().includes(searchQuery)) ||
      (t.style && t.style.toLowerCase().includes(searchQuery))
    );
  }

  if (currentFilter === 'liked') {
    tracks = tracks.filter(t => t.liked);
  } else if (currentFilter === 'generating') {
    tracks = tracks.filter(t => t.status === 'generating' || t.status === 'waiting' || t.status === 'queuing');
  }

  // Agrupamento por Data (Group By Date igual ao Suno)
  const groups = {};
  tracks.forEach(track => {
    const groupName = track.dateGroup || 'Minhas Faixas';
    if (!groups[groupName]) groups[groupName] = [];
    groups[groupName].push(track);
  });

  if (tracks.length === 0 && allSaved.length > 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 60px 20px; color: var(--text-muted); display: flex; flex-direction: column; align-items: center;">
        <p style="font-size: 1.05rem; font-weight: 700; color: #fff; margin-bottom: 6px;">Nenhuma música encontrada</p>
        <p style="font-size: 0.85rem; color: var(--text-secondary);">Tente alterar o termo de busca ou o filtro selecionado.</p>
      </div>
    `;
    return;
  }

  if (Object.keys(groups).length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 80px 20px; color: var(--text-muted); display: flex; flex-direction: column; align-items: center;">
        <div style="width: 56px; height: 56px; border-radius: 50%; background: rgba(255, 255, 255, 0.05); display: flex; align-items: center; justify-content: center; margin-bottom: 16px; color: var(--text-secondary);">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <path d="M9 18V5l12-2v13"></path>
            <circle cx="6" cy="18" r="3"></circle>
            <circle cx="18" cy="16" r="3"></circle>
          </svg>
        </div>
        <p style="font-size: 1.15rem; font-weight: 800; color: #fff; margin-bottom: 6px;">Sua biblioteca está vazia</p>
        <p style="font-size: 0.86rem; color: var(--text-secondary); max-width: 360px; line-height: 1.5; margin-bottom: 20px;">
          Cadastre sua chave KIE.AI e gere sua primeira música real no painel de criação, ou importe uma música existente por Task ID!
        </p>
        <div style="display: flex; gap: 10px; flex-wrap: wrap; justify-content: center;">
          <button class="btn-primary" data-open-modal="settings-modal" style="padding: 10px 22px; font-size: 0.88rem;">
            Configurar Chave KIE.AI
          </button>
          <button class="btn-secondary" data-open-modal="import-task-modal" style="padding: 10px 18px; font-size: 0.88rem;">
            Importar por Task ID
          </button>
        </div>
        <a href="https://kie.ai?ref=e8f6dd065f9a24fc91437577241fd3e6" target="_blank" rel="noopener noreferrer" style="font-size: 0.82rem; color: var(--primary-orange); text-decoration: underline; font-weight: 700; margin-top: 14px;">
          Não tem uma conta? Crie sua conta no KIE.AI &rarr;
        </a>
      </div>
    `;
    return;
  }

  container.innerHTML = Object.entries(groups).map(([dateTitle, trackList]) => {
    return `
      <div class="date-group-block">
        <div class="date-group-title">${escapeHtml(dateTitle)}</div>
        ${trackList.map(track => {
          const isGenerating = track.status === 'generating' || track.status === 'waiting' || track.status === 'queuing';
          const isFailed = track.status === 'fail';

          return `
            <div class="suno-card ${isGenerating ? 'generating-card' : ''}" data-id="${escapeHtml(track.id)}">
              <div class="card-left">
                <div class="card-thumb-wrap" data-track-action="play" data-track-id="${escapeHtml(track.id)}">
                  <img src="${escapeHtml(track.image_url || 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=100&auto=format&fit=crop&q=80')}" alt="cover">
                  ${isGenerating ? `
                    <div class="thumb-play-overlay" style="opacity: 1;">
                      <div class="wave-container">
                        <div class="wave-bar"></div>
                        <div class="wave-bar"></div>
                        <div class="wave-bar"></div>
                      </div>
                    </div>
                  ` : `
                    <div class="thumb-play-overlay">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                        <polygon points="5 3 19 12 5 21 5 3"/>
                      </svg>
                    </div>
                  `}
                  <span class="thumb-duration-pill">${escapeHtml(String(track.duration || '2:30'))}</span>
                </div>

                <div class="card-info">
                  <div class="card-title-row">
                    <span class="card-title">${escapeHtml(track.title || 'Untitled')}</span>
                    ${isGenerating ? `<span style="font-size:0.68rem; color:var(--primary-orange); font-weight:700;">• Gerando no Suno...</span>` : ''}
                    ${isFailed ? `<span style="font-size:0.68rem; color:var(--status-danger); font-weight:700;">• Falhou</span>` : ''}
                  </div>
                  <span class="card-desc">${escapeHtml(track.style || track.prompt || '')}</span>

                  <div class="card-actions-row" style="margin-top: 4px;">
                    <button class="btn-card-icon" title="Gostei" data-track-action="like" data-track-id="${escapeHtml(track.id)}">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="${track.liked ? '#fff' : 'none'}" stroke="currentColor" stroke-width="2">
                        <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path>
                      </svg>
                    </button>
                    <button class="btn-card-icon" title="Não gostei">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3"></path>
                      </svg>
                    </button>
                    <button class="btn-card-share" data-track-action="share" data-track-id="${escapeHtml(track.id)}">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"></path>
                        <polyline points="16 6 12 2 8 6"></polyline>
                        <line x1="12" y1="2" x2="12" y2="15"></line>
                      </svg>
                      Share
                    </button>
                  </div>
                </div>
              </div>

              <div class="card-actions-row">
                ${track.audio_url && !isGenerating ? `
                  <button class="btn-card-icon" title="Baixar MP3" data-track-action="download" data-track-id="${escapeHtml(track.id)}">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                      <polyline points="7 10 12 15 17 10"></polyline>
                      <line x1="12" y1="15" x2="12" y2="3"></line>
                    </svg>
                  </button>
                ` : ''}

                <button class="btn-more-dots" title="Mais opções" data-track-action="menu" data-track-id="${escapeHtml(track.id)}">
                  •••
                </button>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }).join('');
}

function initTrackMenuModal() {
  const modal = document.getElementById('track-menu-modal');
  const btnExtend = document.getElementById('menu-btn-extend');
  const btnCover = document.getElementById('menu-btn-cover');
  const btnCoverArt = document.getElementById('menu-btn-cover-art');
  const btnDownload = document.getElementById('menu-btn-download');
  const btnDelete = document.getElementById('menu-btn-delete');

  btnExtend.addEventListener('click', () => {
    modal.classList.remove('active');
    if (!selectedTrackForMenu) return;

    // Abrir gaveta de áudio
    const chipAudio = document.getElementById('chip-audio');
    const audioDrawer = document.getElementById('audio-drawer');
    if (chipAudio && audioDrawer) {
      chipAudio.classList.add('active');
      audioDrawer.style.display = 'flex';
    }

    // Ativar aba URL e preencher
    const tabUrlBtn = document.querySelector('.audio-tab-btn[data-src-tab="url"]');
    if (tabUrlBtn) tabUrlBtn.click();
    const urlInput = document.getElementById('upload-url-input');
    if (urlInput) urlInput.value = selectedTrackForMenu.audio_url || '';

    // Marcar radio Extensão
    const radioExtend = document.querySelector('input[name="audio-mode"][value="extend"]');
    if (radioExtend) radioExtend.checked = true;

    // Prévia do áudio
    const previewWrap = document.getElementById('audio-preview-wrap');
    const previewAudio = document.getElementById('audio-local-preview');
    const previewName = document.getElementById('audio-preview-name');
    if (previewWrap && previewAudio && previewName && selectedTrackForMenu.audio_url) {
      previewAudio.src = selectedTrackForMenu.audio_url;
      previewName.textContent = `Origem para Extensão: ${selectedTrackForMenu.title}`;
      previewWrap.style.display = 'block';
    }

    document.getElementById('prompt-input').value = `[Continuing from 60s]\n${selectedTrackForMenu.style || ''}`;
    showToast('Modo Extensão pronto! Ajuste o estilo e clique em Criar Música.', 'info');
    document.getElementById('prompt-input').focus();
  });

  btnCover.addEventListener('click', () => {
    modal.classList.remove('active');
    if (!selectedTrackForMenu) return;

    // Abrir gaveta de áudio
    const chipAudio = document.getElementById('chip-audio');
    const audioDrawer = document.getElementById('audio-drawer');
    if (chipAudio && audioDrawer) {
      chipAudio.classList.add('active');
      audioDrawer.style.display = 'flex';
    }

    // Ativar aba URL e preencher
    const tabUrlBtn = document.querySelector('.audio-tab-btn[data-src-tab="url"]');
    if (tabUrlBtn) tabUrlBtn.click();
    const urlInput = document.getElementById('upload-url-input');
    if (urlInput) urlInput.value = selectedTrackForMenu.audio_url || '';

    // Marcar radio Cover
    const radioCover = document.querySelector('input[name="audio-mode"][value="cover"]');
    if (radioCover) radioCover.checked = true;

    // Prévia do áudio
    const previewWrap = document.getElementById('audio-preview-wrap');
    const previewAudio = document.getElementById('audio-local-preview');
    const previewName = document.getElementById('audio-preview-name');
    if (previewWrap && previewAudio && previewName && selectedTrackForMenu.audio_url) {
      previewAudio.src = selectedTrackForMenu.audio_url;
      previewName.textContent = `Origem para Cover: ${selectedTrackForMenu.title}`;
      previewWrap.style.display = 'block';
    }

    if (!customMode) document.querySelector('.mode-pill[data-mode="advanced"]').click();
    document.getElementById('style-input').value = `Cover acústico com violão e percussão suave`;
    showToast('Modo Cover pronto! Digite o novo estilo musical desejado e clique em Criar Música.', 'info');
    document.getElementById('style-input').focus();
  });

  btnCoverArt.addEventListener('click', async () => {
    modal.classList.remove('active');
    if (!selectedTrackForMenu) return;
    if (!selectedTrackForMenu.taskId) {
      showToast('Esta faixa não possui um taskId do KIE associado.', 'error');
      return;
    }
    try {
      showToast('Solicitando nova arte de capa ao KIE.AI...', 'info');
      await createMusicTask({
        operation: 'ai-music-api/cover-generate',
        taskId: selectedTrackForMenu.taskId
      });
      showToast('Capa solicitada com sucesso!', 'success');
    } catch (e) {
      showToast(`Erro ao gerar capa: ${e.message}`, 'error');
    }
  });

  btnDownload.addEventListener('click', () => {
    modal.classList.remove('active');
    if (selectedTrackForMenu?.audio_url) {
      window.downloadTrack(selectedTrackForMenu.audio_url, selectedTrackForMenu.title);
      showToast('Download do áudio iniciado!', 'success');
    }
  });

  btnDelete.addEventListener('click', () => {
    modal.classList.remove('active');
    if (!selectedTrackForMenu) return;
    showConfirm(
      'Excluir Música',
      `Deseja realmente excluir "${selectedTrackForMenu.title || 'esta faixa'}" da sua biblioteca local?`,
      () => {
        removeTrack(selectedTrackForMenu.id);
        renderTracksFeed();
        showToast('Música removida da biblioteca!', 'info');
      }
    );
  });
}

function highlightPlayingCard(trackId) {
  document.querySelectorAll('.suno-card').forEach(card => {
    if (trackId && card.dataset.id === trackId) {
      card.classList.add('playing');
    } else {
      card.classList.remove('playing');
    }
  });
}

// Global actions
window.playTrackById = function(trackId) {
  const track = getSavedTracks().find(t => t.id === trackId);
  if (track && track.audio_url) {
    player.loadTrack(track, true);
  }
};

window.toggleLikeTrack = function(trackId) {
  const track = getSavedTracks().find(t => t.id === trackId);
  if (track) {
    track.liked = !track.liked;
    saveTrack(track);
    renderTracksFeed();
    showToast(track.liked ? 'Adicionada aos favoritos' : 'Removida dos favoritos', 'info');
  }
};

window.shareTrack = function(trackId) {
  const track = getSavedTracks().find(t => t.id === trackId);
  if (track?.audio_url) {
    navigator.clipboard?.writeText(track.audio_url);
    showToast('Link do áudio copiado para a área de transferência!', 'success');
  }
};

window.openTrackMenu = function(trackId) {
  const track = getSavedTracks().find(t => t.id === trackId);
  if (!track) return;
  selectedTrackForMenu = track;
  document.getElementById('track-menu-title').textContent = track.title || 'Ações da Faixa';
  document.getElementById('track-menu-modal').classList.add('active');
};

window.downloadTrack = function(url, title) {
  if (typeof url !== 'string' || !url.startsWith('https://')) { showToast('URL de áudio inválida.', 'error'); return; }
  const a = document.createElement('a');
  a.href = url;
  a.download = `${title || 'musica-suno'}.mp3`;
  a.target = '_blank';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
};

function formatDuration(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>'"]/g, 
    tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
  );
}

// ============================================================================
// Clonagem de Voz Oficial do Suno (Suno Voice Persona — create-voice)
// ============================================================================
function renderClonedVoicesList() {
  const container = document.getElementById('cloned-voices-list');
  if (!container) return;

  const voices = getSavedVoices();
  if (voices.length === 0) {
    container.innerHTML = `
      <div style="font-size: 0.76rem; color: var(--text-muted); padding: 8px 0;">
        Nenhuma voz clonada ainda. Clique no botão acima para clonar a sua voz!
      </div>
    `;
    return;
  }

  container.innerHTML = voices.map(v => {
    const isSelected = selectedCustomVoicePersonaId === v.personaId;
    return `
      <div class="cloned-voice-item ${isSelected ? 'active' : ''}" data-persona="${escapeHtml(v.personaId)}">
        <div style="display: flex; align-items: center; gap: 10px; flex: 1;">
          <div class="vocal-icon-wrap" style="width:34px; height:34px; background: rgba(255, 94, 58, 0.1);">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--primary-orange)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>
          </div>
          <div>
            <div style="font-size: 0.84rem; font-weight: 700; color: #fff;">${escapeHtml(v.name || 'Minha Voz')}</div>
            <div style="font-size: 0.7rem; color: var(--text-muted);">
              ${escapeHtml(v.style || 'Voz Personalizada')} • ID: ${escapeHtml((v.personaId || '').slice(0, 10))}...
            </div>
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          ${isSelected ? `<span style="font-size: 0.7rem; color: var(--primary-orange); font-weight: 700;">Ativa</span>` : ''}
          <button type="button" class="btn-delete-voice" data-del-persona="${escapeHtml(v.personaId)}" style="background: none; border: none; color: var(--text-muted); cursor: pointer; padding: 4px; display: inline-flex; align-items: center;" title="Remover voz">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
          </button>
        </div>
      </div>
    `;
  }).join('');

  // Selecionar voz clonada
  container.querySelectorAll('.cloned-voice-item').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('.btn-delete-voice')) return;
      const personaId = el.dataset.persona;
      const voice = voices.find(v => v.personaId === personaId);
      if (voice) {
        selectedCustomVoicePersonaId = voice.personaId;
        selectedCustomVoiceName = voice.name;
        document.querySelectorAll('.vocal-card-option').forEach(o => o.classList.remove('active'));
        renderClonedVoicesList();
        showToast(`Voz clonada selecionada: ${voice.name}`, 'info');
      }
    });
  });

  // Excluir voz clonada
  container.querySelectorAll('.btn-delete-voice').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const pid = btn.dataset.delPersona;
      showConfirm('Excluir Voz', 'Deseja remover esta voz clonada da sua lista local?', () => {
        removeCustomVoice(pid);
        if (selectedCustomVoicePersonaId === pid) {
          selectedCustomVoicePersonaId = null;
          selectedCustomVoiceName = null;
          const chipVoice = document.getElementById('chip-voice');
          if (chipVoice) {
            chipVoice.innerHTML = `<span>+</span> Preferência Vocal`;
            chipVoice.classList.remove('active');
          }
        }
        renderClonedVoicesList();
        showToast('Voz removida com sucesso.', 'info');
      });
    });
  });
}

function initVoiceCloneWizard() {
  const wizardModal = document.getElementById('voice-clone-modal');
  const btnOpenWizard = document.getElementById('btn-open-clone-wizard');
  const btnCloseWizard = document.getElementById('voice-clone-close-btn');

  const step1Panel = document.getElementById('clone-step-1');
  const step2Panel = document.getElementById('clone-step-2');
  const step3Panel = document.getElementById('clone-step-3');

  const ind1 = document.getElementById('step-ind-1');
  const ind2 = document.getElementById('step-ind-2');
  const ind3 = document.getElementById('step-ind-3');

  let cloneSampleVisualizer = null;
  let cloneVerifyVisualizer = null;
  let phraseReady = false, voiceReady = false, cloneBusy = false;
  let cancelPhrasePolling = null;
  let submittedVoice = null;
  let cloneSession = 0;
  const pendingVoiceKey = 'mysuno_pending_voice';
  function readPendingVoice() {
    try {
      const pending = JSON.parse(localStorage.getItem(pendingVoiceKey) || 'null');
      return typeof pending?.taskId === 'string' && typeof pending?.name === 'string' ? pending : null;
    } catch (err) { console.error('[MySuno] Recuperar verificação:', err.message); return null; }
  }

  if (btnOpenWizard) {
    btnOpenWizard.addEventListener('click', () => {
      if (cloneBusy) return;
      cloneSession++;
      cancelPhrasePolling?.();
      phraseReady = false; voiceReady = false;
      submittedVoice = readPendingVoice();
      cloneSampleBlob = null; cloneSampleName = ''; cloneVerifyBlob = null; cloneValidationTaskId = null;
      for (const id of ['clone-sample-audio', 'verify-audio-preview']) {
        const audio = document.getElementById(id);
        audio.pause();
        if (audio.src.startsWith('blob:')) URL.revokeObjectURL(audio.src);
        audio.removeAttribute('src');
      }
      document.getElementById('clone-sample-preview-wrap').style.display = 'none';
      document.getElementById('verify-preview-wrap').style.display = 'none';
      document.getElementById('btn-record-verify-sample').disabled = true;
      document.getElementById('btn-submit-step-2').disabled = true;
      document.getElementById('clone-sample-file-input').value = '';
      document.getElementById('vocal-modal')?.classList.remove('active');
      wizardModal.classList.add('active');
      goToCloneStep(submittedVoice ? 2 : 1);
      if (submittedVoice) {
        cloneValidationTaskId = submittedVoice.taskId;
        document.getElementById('clone-voice-name').value = submittedVoice.name;
        document.getElementById('clone-voice-style').value = submittedVoice.style;
        document.getElementById('clone-skill-select').value = submittedVoice.singerSkillLevel;
        document.getElementById('validation-phrase-display').textContent = 'Verificação enviada. Retome a consulta para conferir se sua voz está pronta.';
        document.getElementById('btn-submit-step-2').disabled = false;
      }
      document.getElementById('btn-restart-clone').style.display = submittedVoice ? 'block' : 'none';
      document.getElementById('btn-submit-step-2').textContent = submittedVoice ? 'Retomar verificação da voz' : 'Concluir e Criar Voz Clonada';
    });
  }

  if (btnCloseWizard) {
    btnCloseWizard.addEventListener('click', () => {
      if (cloneBusy) { showToast('Aguarde a verificação em andamento.', 'info'); return; }
      cloneSession++;
      cancelPhrasePolling?.();
      clearInterval(cloneSampleTimerInterval);
      wizardModal.classList.remove('active');
      if (cloneSampleVisualizer) cloneSampleVisualizer.stop();
      if (cloneVerifyVisualizer) cloneVerifyVisualizer.stop();
      const sBox = document.getElementById('clone-sample-waveform-box');
      if (sBox) sBox.style.display = 'none';
      const vBox = document.getElementById('clone-verify-waveform-box');
      if (vBox) vBox.style.display = 'none';

      if (cloneMediaRecorder && cloneMediaRecorder.state === 'recording') {
        try { cloneMediaRecorder.stop(); } catch (_) {}
        if (cloneAudioStream) { cloneAudioStream.getTracks().forEach(t => t.stop()); cloneAudioStream = null; }
      }
      if (verifyRecorder && verifyRecorder.state === 'recording') {
        try { verifyRecorder.stop(); } catch (_) {}
        if (verifyStream) { verifyStream.getTracks().forEach(t => t.stop()); verifyStream = null; }
      }
    });
  }

  function goToCloneStep(step) {
    cloneStep = step;
    if (step1Panel) step1Panel.style.display = step === 1 ? 'block' : 'none';
    if (step2Panel) step2Panel.style.display = step === 2 ? 'block' : 'none';
    if (step3Panel) step3Panel.style.display = step === 3 ? 'block' : 'none';

    if (ind1) ind1.className = `clone-step ${step >= 1 ? 'active' : ''}`;
    if (ind2) ind2.className = `clone-step ${step >= 2 ? 'active' : ''}`;
    if (ind3) ind3.className = `clone-step ${step >= 3 ? 'active' : ''}`;
  }

  // --- ETAPA 1: Gravar ou selecionar amostra vocal ---
  const btnRecordSample = document.getElementById('btn-record-clone-sample');
  const sampleRecText = document.getElementById('clone-sample-rec-text');
  const sampleFileInput = document.getElementById('clone-sample-file-input');
  const samplePreviewWrap = document.getElementById('clone-sample-preview-wrap');
  const sampleAudio = document.getElementById('clone-sample-audio');
  const sampleName = document.getElementById('clone-sample-name');
  const btnSubmitStep1 = document.getElementById('btn-submit-step-1');

  if (sampleFileInput) {
    sampleFileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        const file = e.target.files[0];
        cloneSampleBlob = file;
        cloneSampleName = file.name;
        if (sampleAudio) sampleAudio.src = URL.createObjectURL(file);
        if (sampleName) sampleName.textContent = `${file.name}`;
        if (samplePreviewWrap) samplePreviewWrap.style.display = 'block';
        showToast('Amostra de voz selecionada!', 'success');
      }
    });
  }

  let cloneSampleTimerInterval = null;
  let cloneSampleStartTime = 0;
  const sampleTimerEl = document.getElementById('clone-sample-timer');

  if (btnRecordSample) {
    btnRecordSample.addEventListener('click', async () => {
      if (cloneMediaRecorder && cloneMediaRecorder.state === 'recording') {
        if (cloneSampleVisualizer) cloneSampleVisualizer.stop();
        const sampleWaveBox = document.getElementById('clone-sample-waveform-box');
        if (sampleWaveBox) sampleWaveBox.style.display = 'none';

        if (cloneSampleTimerInterval) {
          clearInterval(cloneSampleTimerInterval);
          cloneSampleTimerInterval = null;
        }
        cloneMediaRecorder.stop();
        if (cloneAudioStream) {
          cloneAudioStream.getTracks().forEach(t => t.stop());
          cloneAudioStream = null;
        }
        btnRecordSample.classList.remove('recording');
        if (sampleRecText) sampleRecText.textContent = 'Gravar Amostra Novamente';
        return;
      }

      try {
        const session = cloneSession;
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (session !== cloneSession) { stream.getTracks().forEach(track => track.stop()); return; }
        cloneAudioStream = stream;
        const chunks = [];
        let mime = 'audio/webm';
        if (!MediaRecorder.isTypeSupported('audio/webm')) {
          mime = MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '';
        }
        cloneMediaRecorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
        cloneMediaRecorder.ondataavailable = e => { if (e.data?.size > 0) chunks.push(e.data); };
        const recorder = cloneMediaRecorder;
        monitorRecorder(recorder, stream, () => {
          clearInterval(cloneSampleTimerInterval);
          cloneSampleVisualizer?.stop();
          btnRecordSample.classList.remove('recording');
          sampleRecText.textContent = 'Gravar Amostra';
          cloneSampleBlob = null;
          document.getElementById('clone-sample-waveform-box').style.display = 'none';
        });
        cloneMediaRecorder.onstop = () => {
          clearInterval(cloneSampleTimerInterval);
          stream.getTracks().forEach(track => track.stop());
          if (session !== cloneSession || failedRecorders.has(recorder)) return;
          if (!chunks.length) { showToast('A gravação ficou vazia. Grave novamente.', 'error'); return; }
          const blob = new Blob(chunks, { type: (chunks[0]?.type || mime || 'audio/webm') });
          cloneSampleBlob = blob;
          cloneSampleName = audioFileName(blob, `amostra_voz_${Date.now()}`);
          if (sampleAudio) sampleAudio.src = URL.createObjectURL(blob);
          const durSec = Math.round((Date.now() - cloneSampleStartTime) / 1000);
          if (sampleName) sampleName.textContent = `Gravação da Amostra (${formatDuration(durSec)})`;
          if (samplePreviewWrap) samplePreviewWrap.style.display = 'block';

          if (durSec < 10) {
            showToast('Aviso: O Suno recomenda gravar pelo menos 10 segundos de áudio.', 'error');
          } else {
            showToast('Amostra gravada com sucesso!', 'success');
          }
        };

        const sampleWaveBox = document.getElementById('clone-sample-waveform-box');
        const sampleWaveCanvas = document.getElementById('clone-sample-waveform-canvas');
        if (sampleWaveBox && sampleWaveCanvas) {
          sampleWaveBox.style.display = 'flex';
          if (!cloneSampleVisualizer) cloneSampleVisualizer = new WaveformVisualizer(sampleWaveCanvas);
          cloneSampleVisualizer.start(stream);
        }

        cloneSampleStartTime = Date.now();
        cloneMediaRecorder.start(200);
        btnRecordSample.classList.add('recording');
        if (sampleRecText) sampleRecText.textContent = 'Parar Gravação';
        if (sampleTimerEl) {
          sampleTimerEl.style.display = 'inline-block';
          sampleTimerEl.textContent = '00:00 / 00:30';
        }

        cloneSampleTimerInterval = setInterval(() => {
          const elapsed = Math.floor((Date.now() - cloneSampleStartTime) / 1000);
          if (sampleTimerEl) sampleTimerEl.textContent = `${formatDuration(elapsed)} / 00:30`;
          if (elapsed >= 30) {
            btnRecordSample.click();
            showToast('Tempo limite de 30 segundos atingido para a amostra.', 'info');
          }
        }, 1000);

        showToast('Gravando... Cante ou fale entre 10 e 30 segundos.', 'info');
      } catch (err) {
        cloneAudioStream?.getTracks().forEach(track => track.stop());
        showToast(`Erro ao gravar amostra: ${err.message}`, 'error');
      }
    });
  }

  // Avançar da Etapa 1 para Etapa 2
  if (btnSubmitStep1) {
    btnSubmitStep1.addEventListener('click', async () => {
      if (!cloneSampleBlob) {
        showToast('Por favor, grave ou envie um áudio com a sua voz primeiro!', 'error');
        return;
      }

      if (cloneMediaRecorder?.state === 'recording') { showToast('Pare a gravação antes de continuar.', 'error'); return; }
      cloneBusy = true;
      btnRecordSample.disabled = true;
      sampleFileInput.disabled = true;
      btnSubmitStep1.disabled = true;
      btnSubmitStep1.textContent = 'Enviando amostra e gerando frase...';

      try {
        const duration = await readAudioDuration(cloneSampleBlob);
        if (!Number.isFinite(duration) || duration < 10) throw new Error('A amostra precisa ter pelo menos 10 segundos. Grave novamente.');
        const sampleDuration = Math.min(Math.floor(duration), 30);
        showToast('Enviando amostra vocal para a KIE.AI...', 'info');
        const uploadedUrl = await uploadAudioFile(cloneSampleBlob, cloneSampleName || 'amostra.mp3');

        const lang = document.getElementById('clone-language-select')?.value || 'Portuguese';
        showToast('Solicitando frase de validação de consentimento ao Suno...', 'info');
        const taskData = await createVoiceValidationTask({
          voiceUrl: uploadedUrl,
          vocalStartS: 0,
          vocalEndS: sampleDuration,
          language: lang
        });

        if (!taskData?.taskId) throw new Error('A KIE não retornou o identificador da validação.');
        cloneValidationTaskId = taskData.taskId;
        goToCloneStep(2);

        // Aguardar a frase via polling
        const phraseDisplay = document.getElementById('validation-phrase-display');
        if (phraseDisplay) phraseDisplay.textContent = 'Aguardando frase de validação do Suno (alguns segundos)...';

        cancelPhrasePolling = pollVoiceValidationPhrase(cloneValidationTaskId, {
          onPhraseReady: (phrase) => {
            phraseReady = true;
            btnRecordVerify.disabled = false;
            if (phraseDisplay) phraseDisplay.textContent = `"${phrase}"`;
            showToast('Frase de validação pronta! Leia ou cante no microfone abaixo.', 'success');
          },
          onError: (err) => {
            phraseReady = false;
            if (phraseDisplay) phraseDisplay.textContent = 'Falha ao obter a frase. Feche e inicie uma nova validação.';
            showToast(err.message, 'error');
          }
        });

      } catch (err) {
        showToast(`Erro na etapa 1: ${err.message}`, 'error');
      } finally {
        cloneBusy = false;
        btnRecordSample.disabled = false;
        sampleFileInput.disabled = false;
        btnSubmitStep1.disabled = false;
        btnSubmitStep1.textContent = 'Gerar Frase de Validação →';
      }
    });
  }

  // --- ETAPA 2: Gravar leitura da frase e criar voz ---
  const btnRecordVerify = document.getElementById('btn-record-verify-sample');
  const verifyRecText = document.getElementById('verify-sample-rec-text');
  const verifyAudioPreview = document.getElementById('verify-audio-preview');
  const verifyPreviewWrap = document.getElementById('verify-preview-wrap');
  const btnSubmitStep2 = document.getElementById('btn-submit-step-2');

  let verifyRecorder = null;
  let verifyStream = null;
  window.addEventListener('mysuno:before-update', event => {
    if (cloneBusy || verifyRecorder?.state === 'recording') event.preventDefault();
  });
  document.getElementById('btn-restart-clone')?.addEventListener('click', () => {
    if (cloneBusy) return;
    showConfirm('Iniciar nova validação', 'O pedido anterior pode continuar na KIE. Deseja abandonar seu acompanhamento e começar outra validação?', () => {
      localStorage.removeItem(pendingVoiceKey);
      btnOpenWizard.click();
    });
  });

  if (btnRecordVerify) {
    btnRecordVerify.addEventListener('click', async () => {
      if (!phraseReady || cloneBusy) return;
      if (verifyRecorder && verifyRecorder.state === 'recording') {
        if (cloneVerifyVisualizer) cloneVerifyVisualizer.stop();
        const verifyWaveBox = document.getElementById('clone-verify-waveform-box');
        if (verifyWaveBox) verifyWaveBox.style.display = 'none';

        verifyRecorder.stop();
        if (verifyStream) {
          verifyStream.getTracks().forEach(t => t.stop());
          verifyStream = null;
        }
        btnRecordVerify.classList.remove('recording');
        if (verifyRecText) verifyRecText.textContent = 'Gravar Frase Novamente';
        return;
      }

      try {
        const session = cloneSession;
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (session !== cloneSession) { stream.getTracks().forEach(track => track.stop()); return; }
        verifyStream = stream;
        const chunks = [];
        let mime = 'audio/webm';
        if (!MediaRecorder.isTypeSupported('audio/webm')) {
          mime = MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '';
        }
        verifyRecorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
        verifyRecorder.ondataavailable = e => { if (e.data?.size > 0) chunks.push(e.data); };
        const recorder = verifyRecorder;
        monitorRecorder(recorder, stream, () => {
          cloneVerifyVisualizer?.stop();
          btnRecordVerify.classList.remove('recording');
          verifyRecText.textContent = 'Gravar Leitura da Frase';
          cloneVerifyBlob = null;
          btnSubmitStep2.disabled = true;
          document.getElementById('clone-verify-waveform-box').style.display = 'none';
        });
        verifyRecorder.onstop = () => {
          stream.getTracks().forEach(track => track.stop());
          if (session !== cloneSession || failedRecorders.has(recorder)) return;
          if (!chunks.length) { showToast('A gravação ficou vazia. Grave novamente.', 'error'); return; }
          const blob = new Blob(chunks, { type: mime || 'audio/webm' });
          cloneVerifyBlob = blob;
          btnSubmitStep2.disabled = !phraseReady || !blob.size;
          if (verifyAudioPreview) verifyAudioPreview.src = URL.createObjectURL(blob);
          if (verifyPreviewWrap) verifyPreviewWrap.style.display = 'block';
          showToast('Gravação da frase concluída!', 'success');
        };

        const verifyWaveBox = document.getElementById('clone-verify-waveform-box');
        const verifyWaveCanvas = document.getElementById('clone-verify-waveform-canvas');
        if (verifyWaveBox && verifyWaveCanvas) {
          verifyWaveBox.style.display = 'flex';
          if (!cloneVerifyVisualizer) cloneVerifyVisualizer = new WaveformVisualizer(verifyWaveCanvas);
          cloneVerifyVisualizer.start(stream);
        }

        cloneVerifyBlob = null;
        btnSubmitStep2.disabled = true;
        verifyRecorder.start(200);
        btnRecordVerify.classList.add('recording');
        if (verifyRecText) verifyRecText.textContent = 'Parar Gravação';
        showToast('Gravando... Leia a frase em voz alta!', 'info');
      } catch (err) {
        verifyStream?.getTracks().forEach(track => track.stop());
        showToast(`Erro ao gravar leitura: ${err.message}`, 'error');
      }
    });
  }

  if (btnSubmitStep2) {
    btnSubmitStep2.addEventListener('click', async () => {
      if (!submittedVoice && (!phraseReady || !cloneValidationTaskId || !cloneVerifyBlob || verifyRecorder?.state === 'recording')) {
        showToast('Por favor, grave a leitura da frase de validação primeiro!', 'error');
        return;
      }

      const voiceName = submittedVoice?.name || document.getElementById('clone-voice-name')?.value.trim() || 'Minha Voz';
      const voiceStyle = submittedVoice?.style || document.getElementById('clone-voice-style')?.value.trim() || '';
      const skillLevel = submittedVoice?.singerSkillLevel || document.getElementById('clone-skill-select')?.value || 'intermediate';

      cloneBusy = true;
      btnRecordVerify.disabled = true;
      btnSubmitStep2.disabled = true;
      btnSubmitStep2.textContent = 'Registrando sua voz personalizada no Suno...';

      try {
        if (!submittedVoice) {
          showToast('Enviando áudio de verificação para o KIE.AI...', 'info');
          const verifyUrl = await uploadAudioFile(cloneVerifyBlob, audioFileName(cloneVerifyBlob, 'verificacao'));
          const pendingVoice = { taskId: cloneValidationTaskId, name: voiceName, style: voiceStyle, singerSkillLevel: skillLevel };
          // Persist before submission: a timeout must not cause a duplicate create request.
          localStorage.setItem(pendingVoiceKey, JSON.stringify(pendingVoice));
          submittedVoice = pendingVoice;
          try {
            await createCustomVoiceTask({ taskId: cloneValidationTaskId, verifyUrl, voiceName,
              description: 'Voz de ' + voiceName, style: voiceStyle, singerSkillLevel: skillLevel });
          } catch (err) {
            err.submissionRejected = err.status >= 400 && err.status < 500 && ![408, 429].includes(err.status);
            throw err;
          }
        }

        btnSubmitStep2.textContent = 'Aguardando confirmação da KIE...';
        await waitForVoiceReady(cloneValidationTaskId);
        // Salvar somente após a confirmação remota
        saveCustomVoice({
          id: cloneValidationTaskId,
          personaId: cloneValidationTaskId,
          name: voiceName,
          style: voiceStyle,
          singerSkillLevel: skillLevel,
          createdAt: new Date().toISOString()
        });

        const idDisplay = document.getElementById('clone-created-voice-id');
        if (idDisplay) idDisplay.textContent = cloneValidationTaskId;
        localStorage.removeItem(pendingVoiceKey);
        voiceReady = true;
        goToCloneStep(3);
        showToast('Voz clonada com sucesso!', 'success');
      } catch (err) {
        if (err.terminal || err.submissionRejected) {
          localStorage.removeItem(pendingVoiceKey);
          submittedVoice = null;
          phraseReady = false;
        }
        showToast('Erro ao verificar voz: ' + err.message + (submittedVoice ? ' Use Retomar verificação para consultar novamente.' : ' Feche e inicie uma nova validação.'), 'error');
      } finally {
        cloneBusy = false;
        document.getElementById('btn-restart-clone').style.display = submittedVoice && !voiceReady ? 'block' : 'none';
        btnRecordVerify.disabled = !phraseReady || !!submittedVoice;
        btnSubmitStep2.disabled = voiceReady || (!submittedVoice && !phraseReady);
        btnSubmitStep2.textContent = submittedVoice ? 'Retomar verificação da voz' : 'Concluir e Criar Voz Clonada';
      }
    });
  }

  // --- ETAPA 3: Finalizar e Ativar a Voz ---
  const btnFinish = document.getElementById('btn-finish-clone');
  if (btnFinish) {
    btnFinish.addEventListener('click', () => {
      if (!voiceReady) return;
      wizardModal.classList.remove('active');
      const voiceName = submittedVoice?.name || document.getElementById('clone-voice-name')?.value.trim() || 'Minha Voz';
      selectedCustomVoicePersonaId = cloneValidationTaskId;
      selectedCustomVoiceName = voiceName;

      const chipVoice = document.getElementById('chip-voice');
      if (chipVoice) {
        chipVoice.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px;"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg><span>${escapeHtml(voiceName)}</span>`;
        chipVoice.classList.add('active');
      }

      renderClonedVoicesList();
      showToast(`Voz ativada: ${voiceName}! Pronta para cantar suas músicas.`, 'success');
    });
  }
}

/**
 * 15. Modal de Importação por Task ID do KIE.AI
 * Permite resgatar e sincronizar qualquer música criada no KIE.AI
 */
function initImportTaskModal() {
  const modal = document.getElementById('import-task-modal');
  const btnOpen = document.getElementById('btn-open-import-modal');
  const btnClose = document.getElementById('import-task-close-btn');
  const btnCancel = document.getElementById('import-task-cancel-btn');
  const btnSubmit = document.getElementById('btn-submit-import-task');
  const input = document.getElementById('import-task-input');
  const statusEl = document.getElementById('import-task-status');

  if (!modal || !btnOpen) return;

  btnOpen.addEventListener('click', () => {
    modal.classList.add('active');
    if (input) input.value = '';
    if (statusEl) statusEl.style.display = 'none';
  });

  const closeModal = () => modal.classList.remove('active');
  if (btnClose) btnClose.addEventListener('click', closeModal);
  if (btnCancel) btnCancel.addEventListener('click', closeModal);

  if (btnSubmit) {
    btnSubmit.addEventListener('click', async () => {
      const taskId = input?.value.trim();
      if (!taskId) {
        showToast('Por favor, informe o Task ID da música.', 'error');
        return;
      }

      btnSubmit.disabled = true;
      btnSubmit.textContent = 'Buscando tarefa no KIE.AI...';
      if (statusEl) {
        statusEl.style.display = 'block';
        statusEl.style.background = 'rgba(255, 94, 58, 0.1)';
        statusEl.style.color = '#fff';
        statusEl.textContent = 'Consultando detalhes do Task ID...';
      }

      try {
        const detail = await getTaskDetail(taskId);
        const data = detail.data || detail || {};
        const state = (data.state || '').toLowerCase();

        let tracksList = [];
        try {
          if (data.response?.data && Array.isArray(data.response.data)) {
            tracksList = data.response.data;
          } else if (typeof data.resultJson === 'string') {
            const parsed = JSON.parse(data.resultJson);
            tracksList = parsed.response?.data || parsed.data || [];
          } else if (data.resultJson?.response?.data) {
            tracksList = data.resultJson.response.data;
          }
        } catch (_) {}

        if (tracksList.length === 0 && (state === 'waiting' || state === 'queuing' || state === 'generating')) {
          const pendingTrack = {
            id: `task_${taskId}`,
            taskId: taskId,
            title: 'Música Importada (Em Geração)',
            status: 'generating',
            createdAt: new Date().toISOString(),
            dateGroup: 'Hoje'
          };
          saveTrack(pendingTrack);
          pollMusicProgress(taskId);
          renderTracksFeed();
          closeModal();
          showToast('Tarefa em andamento adicionada! Acompanhando geração...', 'info');
          return;
        }

        if (tracksList.length === 0) {
          throw new Error('Nenhuma faixa de áudio encontrada para este Task ID. Verifique se o ID está correto ou se o processamento já concluiu.');
        }

        tracksList.forEach((st, idx) => {
          const trackObj = {
            id: st.id || `${taskId}_${idx}`,
            taskId: taskId,
            audioId: st.id,
            variationIndex: idx,
            title: st.title || `Música KIE (${taskId.slice(0, 6)})`,
            style: st.tags || '',
            prompt: st.prompt || '',
            model: st.model_name || 'v6-mini',
            audio_url: st.audio_url || '',
            image_url: st.image_url || st.image_large_url || '',
            duration: st.duration || 0,
            status: 'complete',
            createdAt: new Date().toISOString(),
            dateGroup: 'Hoje',
            liked: false
          };
          saveTrack(trackObj);
        });

        renderTracksFeed();
        closeModal();
        showToast(`${tracksList.length} faixa(s) importada(s) com sucesso para sua biblioteca!`, 'success');
      } catch (err) {
        if (statusEl) {
          statusEl.style.display = 'block';
          statusEl.style.background = 'rgba(255, 68, 68, 0.15)';
          statusEl.style.color = '#ff6b6b';
          statusEl.textContent = `Erro: ${err.message}`;
        }
        showToast(`Falha ao importar: ${err.message}`, 'error');
      } finally {
        btnSubmit.disabled = false;
        btnSubmit.textContent = 'Buscar e Importar';
      }
    });
  }
}

/**
 * WaveformVisualizer
 * Visualizador de áudio ao vivo fiel ao design de referência do Suno:
 * - Barras verticais com pontas arredondadas (pills)
 * - Simetria vertical perfeita em torno do eixo central
 * - Cor azul periwinkle (#7c93fc) com atenuação suave nas bordas (envelope bell-curve)
 * - Reativo em tempo real via Web Audio API (AnalyserNode) e animação orgânica fluida
 */
class WaveformVisualizer {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.options = {
      barsCount: options.barsCount || 56,
      barWidth: options.barWidth || 2.8,
      color: options.color || '#7c93fc',
      activeColor: options.activeColor || '#8ea5ff',
      minBarHeight: options.minBarHeight || 3.5,
      ...options
    };
    this.audioCtx = null;
    this.analyser = null;
    this.source = null;
    this.dataArray = null;
    this.animId = null;
    this.barHeights = new Float32Array(this.options.barsCount).fill(this.options.minBarHeight);
    this.phase = 0;
  }

  start(stream) {
    this.stop();
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.audioCtx = new AudioCtx();
        this.analyser = this.audioCtx.createAnalyser();
        this.analyser.fftSize = 128;
        this.analyser.smoothingTimeConstant = 0.8;
        this.source = this.audioCtx.createMediaStreamSource(stream);
        this.source.connect(this.analyser);
        this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
      }
    } catch (e) {
      console.warn('Web Audio API não inicializada:', e);
    }
    this.animate();
  }

  stop() {
    if (this.animId) {
      cancelAnimationFrame(this.animId);
      this.animId = null;
    }
    if (this.source) {
      try { this.source.disconnect(); } catch (_) {}
      this.source = null;
    }
    if (this.audioCtx && this.audioCtx.state !== 'closed') {
      try { this.audioCtx.close(); } catch (_) {}
      this.audioCtx = null;
    }
    this.clear();
  }

  clear() {
    if (!this.ctx || !this.canvas) return;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  animate() {
    this.animId = requestAnimationFrame(() => this.animate());
    if (!this.ctx || !this.canvas) return;

    // Ajuste de alta resolução (Retina / 4K / DPI)
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    const cssWidth = Math.max(Math.floor(rect.width || 360), 200);
    const cssHeight = Math.max(Math.floor(rect.height || 60), 40);

    if (this.canvas.width !== Math.floor(cssWidth * dpr) || this.canvas.height !== Math.floor(cssHeight * dpr)) {
      this.canvas.width = Math.floor(cssWidth * dpr);
      this.canvas.height = Math.floor(cssHeight * dpr);
    }

    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    let hasAudio = false;
    let avgVol = 0;
    if (this.analyser && this.dataArray) {
      this.analyser.getByteFrequencyData(this.dataArray);
      let sum = 0;
      for (let i = 0; i < this.dataArray.length; i++) sum += this.dataArray[i];
      avgVol = sum / this.dataArray.length;
      hasAudio = avgVol > 3.5;
    }

    this.phase += 0.08;
    const count = this.options.barsCount;
    const paddingX = 14;
    const availableW = cssWidth - (paddingX * 2);
    const step = availableW / (count - 1);
    const centerY = cssHeight / 2;
    const maxBarH = cssHeight - 8;

    ctx.lineWidth = this.options.barWidth;
    ctx.lineCap = 'round';
    ctx.strokeStyle = hasAudio ? this.options.activeColor : this.options.color;

    for (let i = 0; i < count; i++) {
      const x = paddingX + (i * step);
      const norm = i / (count - 1); // 0.0 a 1.0

      // Envelope senoidal suave para que as bordas afinem como no design do print
      const envelope = Math.pow(Math.sin(norm * Math.PI), 0.85);

      let targetH = this.options.minBarHeight;
      if (hasAudio) {
        // Mapeia a frequência do microfone
        const binIdx = Math.floor(norm * (this.dataArray.length - 1));
        const freqVal = (this.dataArray[binIdx] || 0) / 255;

        // Pacotes de ondulação harmônica para criar a textura do print
        const harmonic = Math.sin(norm * 16 + this.phase) * 0.22 +
                         Math.cos(norm * 8 - this.phase * 0.8) * 0.16 +
                         Math.sin(norm * 32 + this.phase * 1.4) * 0.1;

        const dynamic = Math.max(0, (freqVal * 1.15) + (harmonic * 0.35));
        targetH = Math.max(this.options.minBarHeight, dynamic * envelope * maxBarH);
      } else {
        // Onda orgânica suave de respiração enquanto em silêncio
        const idleWave = Math.sin(norm * 10 + this.phase * 0.6) * 0.4 +
                         Math.cos(norm * 5 - this.phase * 0.4) * 0.3 + 0.5;
        targetH = Math.max(this.options.minBarHeight, idleWave * envelope * (maxBarH * 0.45));
      }

      // Easing de física: ataque rápido e decaimento suave
      const currentH = this.barHeights[i];
      const speed = targetH > currentH ? 0.4 : 0.18;
      this.barHeights[i] += (targetH - currentH) * speed;

      const renderH = Math.max(this.options.minBarHeight, this.barHeights[i]);

      // Desenho simétrico perfeito em torno da linha central
      ctx.beginPath();
      ctx.moveTo(x, centerY - (renderH / 2));
      ctx.lineTo(x, centerY + (renderH / 2));
      ctx.stroke();
    }
  }
}


async function readAudioDuration(blob) {
  const context = new (window.AudioContext || window.webkitAudioContext)();
  try { return (await context.decodeAudioData(await blob.arrayBuffer())).duration; }
  finally { await context.close(); }
}

const failedRecorders = new WeakSet();
function monitorRecorder(recorder, stream, cleanup) {
  recorder.addEventListener('error', event => {
    failedRecorders.add(recorder);
    stream.getTracks().forEach(track => track.stop());
    cleanup();
    showToast('Falha na gravação: ' + (event.error?.message || 'o dispositivo de áudio foi interrompido.'), 'error');
  });
}

document.addEventListener('click', event => {
  const open = event.target.closest('[data-open-modal]');
  const close = event.target.closest('[data-close-modal]');
  if (open) document.getElementById(open.dataset.openModal)?.classList.add('active');
  if (close) document.getElementById(close.dataset.closeModal)?.classList.remove('active');
  const button = event.target.closest('[data-track-action]');
  if (!button) return;
  const id = button.dataset.trackId;
  const actions = { play: window.playTrackById, like: window.toggleLikeTrack, share: window.shareTrack, menu: window.openTrackMenu };
  if (button.dataset.trackAction === 'download') {
    const track = getSavedTracks().find(track => track.id === id);
    if (track) window.downloadTrack(track.audio_url, track.title);
  } else { actions[button.dataset.trackAction]?.(id); }
});
