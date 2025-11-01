(() => {
  console.log('AlphaOCR content script loaded');

  const DIALOG_ID = 'alphaocr-dialog-unique-01';
  const CONTENT_ID = 'alphaocr-content';
  let mouseX = 0, mouseY = 0;
  let isVisible = false;

  // Track mouse position
  document.addEventListener('mousemove', (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
  }, { capture: true, passive: true });

  // Toggle popup with Shift (and check for Alt)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Shift') {
      if (isTypingArea(document.activeElement)) return;
      if (isVisible) {
        hideDialog();
        return;
      }

      const orientation = e.altKey ? "vertical" : "horizontal";

      // --- LOGIC FIX: Don't show dialog until after capture ---
      chrome.runtime.sendMessage({
        action: "captureAndAnalyze",
        x: mouseX,
        y: mouseY,
        pixelRatio: window.devicePixelRatio,
        orientation: orientation
      }, (response) => {
        if (isVisible) return; 

        // 1. NOW show the dialog
        // We pass the response so it can be populated immediately
        showDialog(mouseX, mouseY, response);
      });
    }
    
    if (e.key === 'Escape' && isVisible) {
      hideDialog();
    }
  }, true);

  // Hide when clicking outside the dialog
  document.addEventListener('mousedown', (e) => {
    if (!isVisible) return;
    const dialog = document.getElementById(DIALOG_ID);
    if (dialog && !dialog.contains(e.target)) {
      hideDialog();
    }
  }, true);

  /**
   * Creates and displays the dialog, checking viewport boundaries.
   * Now also populates the content immediately.
   */
  function showDialog(x, y, response) {
    hideDialog(); // Ensure only one dialog exists
    const d = document.createElement('div');
    d.id = DIALOG_ID;

    // --- NEW: Use clamp() for fluid typography ---
    // clamp(MIN, PREFERRED, MAX)
    const headerFontSize = "clamp(12px, 1.4vw, 18px)";
    const loadingFontSize = "clamp(14px, 1.5vw, 18px)";
    
    // 1. Set initial "Loading" or "Error" content
    let contentHtml = '';
    if (response && response.text) {
      const furiganaFontSize = "clamp(16px, 2vw, 26px)";
      const textFontSize = "clamp(14px, 1.6vw, 20px)";
      const translationFontSize = "clamp(12px, 1.4vw, 18px)";

      contentHtml = `
        <div style="font-size: ${furiganaFontSize}; margin-bottom: 8px; color: #eee; word-wrap: break-word;">${escapeHtml(response.furigana)}</div>
        <div style="font-size: ${textFontSize}; color: #fff; word-wrap: break-word;">${escapeHtml(response.text)}</div>
        <hr style="border: 0; border-top: 1px solid #444; margin: 12px 0;">
        <div style="font-size: ${translationFontSize}; color: #ccc; white-space: pre-wrap; word-wrap: break-word;">${escapeHtml(response.translation)}</div>
      `;
    } else {
      const errorText = response.error || "❌ Analysis failed.";
      contentHtml = `<div style="font-size: ${loadingFontSize};">${escapeHtml(errorText)}</div>`;
    }

    // 2. Set dialog structure
    d.innerHTML = `
      <h3 style="margin:0 0 8px 0; text-align:center; color: #888; font-size: ${headerFontSize};">AlphaOCR</h3>
      <div id="${CONTENT_ID}" style="white-space:pre-wrap; overflow:auto; height:calc(100% - 34px);">
        ${contentHtml}
      </div>
    `;

    // 3. Set dialog positioning and static styles
    const DIALOG_WIDTH = 300; // 300px logical width
    const DIALOG_MIN_HEIGHT = 200; // 200px logical min-height
    const CURSOR_OFFSET = 12;

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let finalLeft = x + CURSOR_OFFSET;
    let finalTop = y + CURSOR_OFFSET;

    // Check if it goes off-screen horizontally (right side)
    if (finalLeft + DIALOG_WIDTH > viewportWidth) {
      finalLeft = x - DIALOG_WIDTH - CURSOR_OFFSET;
      if (finalLeft < 0) finalLeft = 0;
    }

    // Check if it goes off-screen vertically (bottom side)
    if (finalTop + DIALOG_MIN_HEIGHT > viewportHeight) {
      finalTop = y - DIALOG_MIN_HEIGHT - CURSOR_OFFSET;
      if (finalTop < 0) finalTop = 0;
    }
    
    Object.assign(d.style, {
      position: 'fixed',
      left: `${finalLeft}px`,
      top: `${finalTop}px`,
      width: `${DIALOG_WIDTH}px`,
      minHeight: `${DIALOG_MIN_HEIGHT}px`,
      // Safety nets:
      maxWidth: '90vw', 
      maxHeight: '80vh', 
      zIndex: 2147483647,
      background: 'rgba(20, 20, 20, 0.95)',
      border: '1px solid rgba(255, 255, 255, 0.1)',
      borderRadius: '8px',
      boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
      padding: '12px',
      boxSizing: 'border-box',
      fontFamily: 'system-ui, sans-serif',
      color: '#eee',
      overflow: 'hidden',
      backdropFilter: 'blur(10px)',
    });

    // 4. Center content *only* if it's an error/loading message
    const contentDiv = d.querySelector(`#${CONTENT_ID}`);
    if (!response || !response.text) {
      Object.assign(contentDiv.style, {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      });
    }

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

  // --- These functions are no longer needed, as `showDialog` does it all ---
  // function updateDialog(text) { ... }
  // function updateDialogHtml(html) { ... }
  // ---

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

})();

