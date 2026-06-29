const NATIVE_HOST = 'com.alphaocr.launcher';
const HEALTH_URL = 'http://127.0.0.1:5000/health';
const SHUTDOWN_URL = 'http://127.0.0.1:5000/shutdown';

document.addEventListener('DOMContentLoaded', () => {
  const output = document.getElementById('output');
  const toggle = document.getElementById('enabled-toggle');
  const startBtn = document.getElementById('start-backend');
  const statusEl = document.getElementById('backend-status');

  let mode = 'start'; // 'start' | 'stop' — what a click does right now

  // --- Snipping toggle (persisted, gates the Shift trigger) ---
  chrome.storage.local.get({ enabled: false }, ({ enabled }) => { toggle.checked = enabled; });
  toggle.addEventListener('change', () => chrome.storage.local.set({ enabled: toggle.checked }));

  // --- Backend status + launch/stop ---
  function setReady() {
    statusEl.textContent = '✅ Running';
    startBtn.textContent = 'Stop';
    startBtn.classList.add('stop');
    startBtn.disabled = false;
    mode = 'stop';
    output.textContent = 'Enable snipping, then press Shift and drag a box over Japanese text.';
  }

  function setDown() {
    statusEl.textContent = '⚠️ Not running';
    startBtn.textContent = 'Start';
    startBtn.classList.remove('stop');
    startBtn.disabled = false;
    mode = 'start';
  }

  // Returns 'ready' | 'loading' | 'down'.
  function checkHealth() {
    return fetch(HEALTH_URL)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('bad status'))))
      .then((data) => {
        if (data.model_loaded) { setReady(); return 'ready'; }
        statusEl.textContent = '⏳ Loading model…';
        return 'loading';
      })
      .catch(() => { setDown(); return 'down'; });
  }

  function pollUntilReady(triesLeft) {
    checkHealth().then((state) => {
      if (state === 'ready') return;
      if (triesLeft <= 0) {
        statusEl.textContent = '⏳ Still loading…';
        output.textContent = 'The OCR model is taking a while to load (first run downloads it). Reopen this popup to re-check.';
        startBtn.disabled = false;
        return;
      }
      setTimeout(() => pollUntilReady(triesLeft - 1), 1500);
    });
  }

  function pollUntilDown(triesLeft) {
    checkHealth().then((state) => {
      if (state === 'down') return;
      if (triesLeft <= 0) {
        statusEl.textContent = '⚠️ Still responding…';
        output.textContent = 'The backend did not stop. You may need to end python.exe manually.';
        startBtn.disabled = false;
        return;
      }
      setTimeout(() => pollUntilDown(triesLeft - 1), 800);
    });
  }

  function startBackend() {
    startBtn.disabled = true;
    statusEl.textContent = 'Starting…';
    output.textContent = '';
    chrome.runtime.sendNativeMessage(NATIVE_HOST, { action: 'start' }, (resp) => {
      if (chrome.runtime.lastError) {
        statusEl.textContent = '⚠️ Launcher not set up';
        output.textContent =
          'The native launcher isn’t registered yet. Run native_host\\register_native_host.ps1 once (see README), then reopen this popup.';
        setDown();
        return;
      }
      if (!resp || !resp.ok) {
        statusEl.textContent = '❌ Failed to start';
        output.textContent = (resp && resp.error) || 'Unknown error launching the backend.';
        setDown();
        return;
      }
      statusEl.textContent = '⏳ Loading model…';
      pollUntilReady(40); // ~60s
    });
  }

  function stopBackend() {
    startBtn.disabled = true;
    statusEl.textContent = 'Stopping…';
    output.textContent = '';
    fetch(SHUTDOWN_URL, { method: 'POST' })
      .catch(() => {}) // the connection often drops as the process exits — that's fine
      .finally(() => pollUntilDown(20)); // ~16s
  }

  startBtn.addEventListener('click', () => {
    if (mode === 'stop') stopBackend();
    else startBackend();
  });

  checkHealth();
});
