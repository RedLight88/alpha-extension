(() => {
  console.log('AlphaOCR content script loaded');

  const DIALOG_ID = 'alphaocr-dialog-unique-01';
  const CONTENT_ID = 'alphaocr-content';
  const OVERLAY_ID = 'alphaocr-snip-overlay';
  const SELECTION_ID = 'alphaocr-snip-selection';

  let mouseX = 0, mouseY = 0;
  let lastTranslation = null;
  let snipping = false;
  let startX = 0, startY = 0;
  let enabled = false; // gated by the toolbar toggle (chrome.storage 'enabled')

  // Load the toggle state and keep it live across changes from the popup.
  chrome.storage.local.get({ enabled: false }, ({ enabled: e }) => { enabled = e; });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.enabled) enabled = changes.enabled.newValue;
  });

  // Track mouse position (used to place the result dialog)
  document.addEventListener('mousemove', (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
  }, { capture: true, passive: true });

  // Shift (pressed alone) starts the snip selection — only while enabled. Escape cancels.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Shift' && !e.repeat) {
      if (!enabled) return;
      if (isTypingArea(document.activeElement)) return;
      if (snipping) return;
      startSnip();
      return;
    }
    if (e.key === 'Escape') {
      if (snipping) cancelSnip();
      else hideDialog();
    }
  }, true);

  // ---- Snip selection overlay ----

  function startSnip() {
    snipping = true;
    hideDialog();

    const overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    Object.assign(overlay.style, {
      position: 'fixed',
      inset: '0',
      zIndex: 2147483646,
      cursor: 'crosshair',
      background: 'rgba(0,0,0,0.12)',
    });

    const selection = document.createElement('div');
    selection.id = SELECTION_ID;
    Object.assign(selection.style, {
      position: 'fixed',
      border: '1px solid #fff',
      background: 'transparent',
      boxShadow: '0 0 0 1px rgba(0,0,0,0.5)',
      display: 'none',
      pointerEvents: 'none',
    });
    overlay.appendChild(selection);

    overlay.addEventListener('mousedown', onSnipDown, true);
    overlay.addEventListener('mousemove', onSnipMove, true);
    overlay.addEventListener('mouseup', onSnipUp, true);

    document.documentElement.appendChild(overlay);
  }

  function onSnipDown(e) {
    e.preventDefault();
    e.stopPropagation();
    startX = e.clientX;
    startY = e.clientY;
    const selection = document.getElementById(SELECTION_ID);
    if (selection) {
      Object.assign(selection.style, {
        display: 'block',
        left: `${startX}px`,
        top: `${startY}px`,
        width: '0px',
        height: '0px',
      });
    }
  }

  function onSnipMove(e) {
    const selection = document.getElementById(SELECTION_ID);
    if (!selection || selection.style.display === 'none') return;
    const rect = normalizeRect(startX, startY, e.clientX, e.clientY);
    Object.assign(selection.style, {
      left: `${rect.x}px`,
      top: `${rect.y}px`,
      width: `${rect.w}px`,
      height: `${rect.h}px`,
    });
  }

  function onSnipUp(e) {
    e.preventDefault();
    e.stopPropagation();
    const rect = normalizeRect(startX, startY, e.clientX, e.clientY);
    const dpr = window.devicePixelRatio || 1;
    cleanupSnip();

    if (rect.w < 4 || rect.h < 4) {
      // Treat as an accidental click — nothing to OCR.
      return;
    }

    // Place the dialog just below the selection.
    showDialog(rect.x, rect.y + rect.h + 8);
    updateDialog('⏳ Capturing…');

    chrome.runtime.sendMessage({ action: 'snip' }, (response) => {
      if (chrome.runtime.lastError || !response || !response.screenshot) {
        updateDialog('❌ Failed to capture screenshot');
        return;
      }
      cropAndSend(response.screenshot, rect, dpr);
    });
  }

  function cleanupSnip() {
    snipping = false;
    const overlay = document.getElementById(OVERLAY_ID);
    if (overlay) overlay.remove();
  }

  function cancelSnip() {
    cleanupSnip();
  }

  function normalizeRect(x1, y1, x2, y2) {
    return {
      x: Math.min(x1, x2),
      y: Math.min(y1, y2),
      w: Math.abs(x2 - x1),
      h: Math.abs(y2 - y1),
    };
  }

  // ---- Crop the screenshot to the selected region and send for OCR ----

  function cropAndSend(screenshotDataUrl, rect, dpr) {
    const img = new Image();
    img.onload = () => {
      const sx = Math.round(rect.x * dpr);
      const sy = Math.round(rect.y * dpr);
      const sw = Math.round(rect.w * dpr);
      const sh = Math.round(rect.h * dpr);

      const canvas = document.createElement('canvas');
      canvas.width = sw;
      canvas.height = sh;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
      const cropped = canvas.toDataURL('image/png');

      updateDialog('⏳ Sending for OCR…');
      chrome.runtime.sendMessage({ action: 'ocrImage', src: cropped }, (response) => {
        if (chrome.runtime.lastError) {
          updateDialog('❌ Failed to reach OCR backend');
        }
        // The final text also arrives via the setTranslation broadcast.
        if (response && response.ok === false) {
          updateDialog('❌ OCR failed');
        }
      });
    };
    img.onerror = () => updateDialog('❌ Failed to load screenshot');
    img.src = screenshotDataUrl;
  }

  // ---- Result dialog ----

  function showDialog(x, y) {
    hideDialog();
    const d = document.createElement('div');
    d.id = DIALOG_ID;
    const initialText = lastTranslation || 'No text yet';
    d.innerHTML = `
      <h3 id="${DIALOG_ID}-header" style="margin:0 0 8px 0; font-size:16px; text-align:center; color:#111; cursor:move; user-select:none;">Translation</h3>
      <div id="${CONTENT_ID}" style="white-space:pre-wrap;overflow:auto;min-height:0;flex:1 1 auto;color:#111;">
        ${escapeHtml(initialText)}
      </div>
    `;

    // Size to content (so few words = small box, many words = larger), but cap
    // to a fraction of the viewport. The vw/vh caps scale with page zoom, and
    // overflow scrolls once the content exceeds the cap.
    Object.assign(d.style, {
      position: 'fixed',
      left: `${x}px`,
      top: `${y}px`,
      display: 'flex',
      flexDirection: 'column',
      width: 'max-content',
      minWidth: '120px',
      maxWidth: 'min(360px, 90vw)',
      maxHeight: 'min(70vh, 460px)',
      zIndex: 2147483647,
      background: '#ffffff',
      border: '1px solid rgba(0,0,0,0.2)',
      borderRadius: '8px',
      boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
      padding: '10px 12px',
      boxSizing: 'border-box',
      fontFamily: 'system-ui, sans-serif',
      fontSize: '14px',
      color: '#111',
    });
    document.documentElement.appendChild(d);
    clampToViewport(d, x, y);
    makeDraggable(d, document.getElementById(`${DIALOG_ID}-header`));
  }

  // Keep the whole dialog on screen given its current rendered size.
  function clampToViewport(d, desiredLeft, desiredTop) {
    const margin = 8;
    const maxLeft = Math.max(margin, window.innerWidth - d.offsetWidth - margin);
    const maxTop = Math.max(margin, window.innerHeight - d.offsetHeight - margin);
    d.style.left = `${Math.min(Math.max(margin, desiredLeft), maxLeft)}px`;
    d.style.top = `${Math.min(Math.max(margin, desiredTop), maxTop)}px`;
  }

  // Let the user drag the dialog around by its header.
  function makeDraggable(d, handle) {
    if (!handle) return;
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const startX = e.clientX;
      const startY = e.clientY;
      const origLeft = d.offsetLeft;
      const origTop = d.offsetTop;

      const onMove = (ev) => clampToViewport(d, origLeft + (ev.clientX - startX), origTop + (ev.clientY - startY));
      const onUp = () => {
        document.removeEventListener('mousemove', onMove, true);
        document.removeEventListener('mouseup', onUp, true);
      };
      document.addEventListener('mousemove', onMove, true);
      document.addEventListener('mouseup', onUp, true);
    }, true);
  }

  function hideDialog() {
    const existing = document.getElementById(DIALOG_ID);
    if (existing) existing.remove();
  }

  function isTypingArea(el) {
    if (!el) return false;
    const tag = (el.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') return true;
    if (el.isContentEditable) return true;
    return false;
  }

  function updateDialog(text) {
    lastTranslation = text == null ? null : String(text);
    const container = document.getElementById(CONTENT_ID);
    if (container) container.textContent = lastTranslation || 'No text yet';
    // Content (and therefore size) changed — keep the box on screen.
    const d = document.getElementById(DIALOG_ID);
    if (d) clampToViewport(d, d.offsetLeft, d.offsetTop);
  }

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (!message || typeof message !== 'object') return;
      if (message.action === 'setTranslation') {
        updateDialog(message.text);
        sendResponse && sendResponse({ ok: true });
      }
      return true;
    });
  }

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
})();
