let installPrompt;
let registration;
let applying = false;
const button = id => document.getElementById(id);
function announce(message) {
  button('pwa-status').textContent = message;
  button('pwa-notice').hidden = false;
}
function showUpdate() {
  if (!registration?.waiting) return;
  announce('Uma nova versão do MySuno está pronta.');
  button('pwa-update-btn').hidden = false;
}
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  installPrompt = event;
  button('pwa-install-btn').hidden = false;
});
window.addEventListener('appinstalled', () => {
  installPrompt = null;
  button('pwa-install-btn').hidden = true;
});
window.addEventListener('DOMContentLoaded', async () => {
  button('pwa-install-btn').addEventListener('click', async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    button('pwa-install-btn').hidden = true;
  });
  button('pwa-update-btn').addEventListener('click', async () => {
    try {
      // Every open tab must agree before activating the shared service worker.
      const response = await canApplyUpdate();
      if (!response) { announce('Finalize a geração ou gravação antes de atualizar.'); return; }
      if (registration?.waiting) {
        applying = true;
        registration.waiting.postMessage({ type: 'ACTIVATE_UPDATE' });
      }
    } catch (error) { console.error('[MySuno] Atualizar app:', error.message); }
  });
  button('pwa-dismiss-btn').addEventListener('click', () => { button('pwa-notice').hidden = true; });
  if (document.querySelector('meta[name="mysuno-static"]')?.content !== 'true') return;
  if (!('serviceWorker' in navigator) || !['http:', 'https:'].includes(location.protocol)) return;
  try {
    registration = await navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' });
    showUpdate();
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => { if (worker.state === 'installed' && navigator.serviceWorker.controller) showUpdate(); });
    });
    let refreshed = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (applying && !refreshed) { refreshed = true; location.reload(); }
    });
    const check = () => registration.update().then(showUpdate).catch(error => console.error('[MySuno] Verificar atualização:', error.message));
    window.addEventListener('online', check);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
    setInterval(check, 5 * 60 * 1000);
  } catch (error) { console.error('[MySuno] Instalação PWA:', error.message); }
});
function localBusy() {
  const event = new Event('mysuno:before-update', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
// Coordinate active jobs across tabs without exchanging keys, prompts or user data.
const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('mysuno-update:' + new URL('.', location.href).pathname) : null;
channel?.addEventListener('message', event => {
  if (event.data?.type === 'check') channel.postMessage({ type: 'state', id: event.data.id, busy: localBusy() });
});
async function canApplyUpdate() {
  if (localBusy()) return false;
  if (!channel) return true;
  const id = crypto.randomUUID();
  let busy = false;
  const listener = event => { if (event.data?.type === 'state' && event.data.id === id && event.data.busy) busy = true; };
  channel.addEventListener('message', listener);
  channel.postMessage({ type: 'check', id });
  await new Promise(resolve => setTimeout(resolve, 400));
  channel.removeEventListener('message', listener);
  return !busy && !localBusy();
}
