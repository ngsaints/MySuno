/**
 * MySuno - Bottom Audio Player Manager
 */

class AudioPlayer {
  constructor() {
    this.audio = new Audio();
    this.currentTrack = null;
    this.isPlaying = false;
    
    // DOM Elements
    this.container = document.querySelector('.bottom-player');
    this.thumbEl = document.getElementById('player-thumb');
    this.titleEl = document.getElementById('player-title');
    this.subEl = document.getElementById('player-sub');
    this.playBtn = document.getElementById('player-play-btn');
    this.seekBar = document.getElementById('player-seek');
    this.timeCurrent = document.getElementById('player-time-current');
    this.timeTotal = document.getElementById('player-time-total');
    this.volumeBar = document.getElementById('player-volume');
    this.downloadBtn = document.getElementById('player-download-btn');

    this.bindEvents();
  }

  bindEvents() {
    // Play/Pause button
    if (this.playBtn) {
      this.playBtn.addEventListener('click', () => this.togglePlay());
    }

    // Audio events
    this.audio.addEventListener('timeupdate', () => this.onTimeUpdate());
    this.audio.addEventListener('loadedmetadata', () => this.onLoadedMetadata());
    this.audio.addEventListener('ended', () => {
      this.isPlaying = false;
      this.updatePlayBtnIcon();
      this.dispatchEvent('ended');
    });

    // Seek bar scrubbing
    if (this.seekBar) {
      this.seekBar.addEventListener('input', (e) => {
        if (this.audio.duration) {
          const seekTo = (e.target.value / 100) * this.audio.duration;
          this.audio.currentTime = seekTo;
        }
      });
    }

    // Volume control
    if (this.volumeBar) {
      this.volumeBar.addEventListener('input', (e) => {
        this.audio.volume = e.target.value / 100;
      });
      // Default volume
      this.audio.volume = 0.8;
      this.volumeBar.value = 80;
    }

    // Download button
    if (this.downloadBtn) {
      this.downloadBtn.addEventListener('click', () => {
        if (this.currentTrack && this.currentTrack.audio_url) {
          const a = document.createElement('a');
          a.href = this.currentTrack.audio_url;
          a.download = `${this.currentTrack.title || 'mysuno-track'}.mp3`;
          a.target = '_blank';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        }
      });
    }
  }

  loadTrack(track, autoplay = true) {
    if (!track || !track.audio_url) return;
    
    this.currentTrack = track;
    this.audio.src = track.audio_url;

    // Update UI elements
    if (this.titleEl) this.titleEl.textContent = track.title || 'Faixa Sem Título';
    if (this.subEl) this.subEl.textContent = track.style || track.prompt || 'Música Suno V6';
    if (this.thumbEl) {
      if (track.image_url) {
        this.thumbEl.src = track.image_url;
        this.thumbEl.style.display = 'block';
        const placeholder = document.getElementById('player-thumb-placeholder');
        if (placeholder) placeholder.style.display = 'none';
      }
    }

    if (autoplay) {
      this.play();
    }
  }

  play() {
    if (!this.audio.src) return;
    this.audio.play()
      .then(() => {
        this.isPlaying = true;
        this.updatePlayBtnIcon();
        this.dispatchEvent('play', this.currentTrack);
      })
      .catch(err => console.error('[MySuno] Erro ao reproduzir áudio:', err.message));
  }

  pause() {
    this.audio.pause();
    this.isPlaying = false;
    this.updatePlayBtnIcon();
    this.dispatchEvent('pause', this.currentTrack);
  }

  togglePlay() {
    if (this.isPlaying) {
      this.pause();
    } else {
      this.play();
    }
  }

  updatePlayBtnIcon() {
    if (!this.playBtn) return;
    if (this.isPlaying) {
      this.playBtn.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
          <rect x="6" y="4" width="4" height="16" rx="1"/>
          <rect x="14" y="4" width="4" height="16" rx="1"/>
        </svg>
      `;
    } else {
      this.playBtn.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
          <polygon points="5 3 19 12 5 21 5 3"/>
        </svg>
      `;
    }
  }

  onTimeUpdate() {
    if (!this.audio.duration) return;
    const current = this.audio.currentTime;
    const duration = this.audio.duration;
    
    if (this.timeCurrent) this.timeCurrent.textContent = this.formatTime(current);
    if (this.seekBar) this.seekBar.value = (current / duration) * 100;
  }

  onLoadedMetadata() {
    if (this.timeTotal) this.timeTotal.textContent = this.formatTime(this.audio.duration);
  }

  formatTime(seconds) {
    if (isNaN(seconds) || seconds === null) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  dispatchEvent(name, detail) {
    window.dispatchEvent(new CustomEvent(`player:${name}`, { detail }));
  }
}

export const player = new AudioPlayer();
