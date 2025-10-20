(() => {
  console.log('Shift Hello content script loaded');

  const DIALOG_ID = 'shift-hello-dialog-unique-01';
  const CONTENT_ID = 'shift-hello-content';
  let mouseX = 0, mouseY = 0;
  let isVisible = false;
  let lastTranslation = null;

  // Track mouse position
  document.addEventListener('mousemove', (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
  }, { capture: true, passive: true });

  // Toggle popup with Shift
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Shift') {
      if (isTypingArea(document.activeElement)) return;
      if (isVisible) hideDialog();
      else showDialog(mouseX, mouseY);
    }
    if (e.key === 'Escape' && isVisible) hideDialog();
  }, true);

  // Hide when clicking outside (unless on image in OCR mode)
  document.addEventListener('mousedown', (e) => {
    if (!isVisible) return;
    const dialog = document.getElementById(DIALOG_ID);

    // 🔹 If clicked an <img> → send for OCR
  if (e.target.tagName && e.target.tagName.toLowerCase() === 'img') {
  const img = e.target;
  updateDialog("⏳ Converting image...");

  // Convert image to base64 using an offscreen canvas
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const base64 = canvas.toDataURL('image/png'); // format: "data:image/png;base64,..."

  updateDialog("⏳ Sending for OCR...");
  chrome.runtime.sendMessage(
    {
      action: "ocrImage",
      src: base64  // send base64 string to background.js
    },
    (response) => {
      if (response && response.text) {
        updateDialog(response.text);
      } else {
        updateDialog("❌ Failed to get OCR text");
      }
    }
  );

  return; // don’t close popup
}


    // Normal outside-click → close popup
    if (dialog && !dialog.contains(e.target)) hideDialog();
  }, true);

  function showDialog(x, y) {
    hideDialog();
    const d = document.createElement('div');
    d.id = DIALOG_ID;
    const initialText = lastTranslation || 'No word selected yet';
    d.innerHTML = `
      <h3 style="margin:0 0 8px 0; font-size:16px; text-align:center;">Translation</h3>
      <div id="${CONTENT_ID}" style="white-space:pre-wrap;overflow:auto;height:calc(100% - 34px);">
        ${escapeHtml(initialText)}
      </div>
    `;
    Object.assign(d.style, {
      position: 'fixed',
      left: `${x + 12}px`,
      top: `${y + 12}px`,
      width: '300px',
      height: '300px',
      zIndex: 2147483647,
      background: 'black',
      border: '1px solid rgba(0,0,0,0.2)',
      borderRadius: '8px',
      boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
      padding: '12px',
      boxSizing: 'border-box',
      fontFamily: 'system-ui, sans-serif',
      fontSize: '14px',
      color: '#111',
      overflow: 'hidden'
    });
    document.documentElement.appendChild(d);
    isVisible = true;
  }

  function hideDialog() {
    const existing = document.getElementById(DIALOG_ID);
    if (existing) existing.remove();
    isVisible = false;
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
    if (container) container.textContent = lastTranslation || 'No word selected yet';
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
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
})();
