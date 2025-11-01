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

      chrome.runtime.sendMessage({
        action: "captureAndAnalyze",
        x: mouseX,
        y: mouseY,
        pixelRatio: window.devicePixelRatio,
        orientation: orientation
      }, (response) => {
        if (isVisible) return; 
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

    const headerFontSize = "clamp(12px, 1.4vw, 18px)";
    const textFontSize = "clamp(14px, 1.6vw, 19px)"; // Main text
    const furiganaFontSize = "clamp(11px, 1.2vw, 16px)"; // Smaller furigana
    const translationFontSize = "clamp(12px, 1.4vw, 17px)"; // Slightly smaller translation
    
    let contentHtml = '';
    
    if (Array.isArray(response) && response.length > 0) {
      
      contentHtml = response.map(item => {
        return `
          <div style="
            font-size: ${textFontSize}; 
            margin-bottom: 12px; 
            line-height: 1.4; 
            white-space: nowrap; 
            overflow: hidden; 
            text-overflow: ellipsis;
            padding-bottom: 2px;
          ">
            <span style="color: #fff; font-weight: 600;">${escapeHtml(item.text)}</span>
            <span style="color: #ccc; font-size: ${furiganaFontSize};"> (${escapeHtml(item.furigana)})</span>
            <span style="color: #aaa; font-size: ${translationFontSize};"> - ${escapeHtml(item.translation)}</span>
          </div>
        `
      }).join('');

    } else {
      // It's an error or empty
      const loadingFontSize = "clamp(14px, 1.5vw, 18px)";
      const errorText = response.error || "❌ Analysis failed.";
      contentHtml = `<div style="font-size: ${loadingFontSize};">${escapeHtml(errorText)}</div>`;
    }

    // 2. Set dialog structure
    // --- THIS IS THE FIX (Part 1) ---
    // Removed height calculation. Added flex: 1 to make it fill space.
    d.innerHTML = `
      <h3 style="margin:0 0 12px 0; text-align:center; color: #888; font-size: ${headerFontSize}; border-bottom: 1px solid #444; padding-bottom: 8px;">AlphaOCR</h3>
      <div id="${CONTENT_ID}" style="flex: 1 1 auto; overflow-y:auto; overflow-x: hidden; padding-right: 5px;">
        ${contentHtml}
      </div>
    `;

    // 3. Set dialog positioning and static styles
    const DIALOG_WIDTH = 350; 
    const CURSOR_OFFSET = 12;

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    const DIALOG_MAX_HEIGHT_VH = 80; // 80vh
    const DIALOG_MAX_HEIGHT_PX = viewportHeight * (DIALOG_MAX_HEIGHT_VH / 100);

    let finalLeft = x + CURSOR_OFFSET;
    let finalTop = y + CURSOR_OFFSET;

    // Check horizontal
    if (finalLeft + DIALOG_WIDTH > viewportWidth) {
      finalLeft = x - DIALOG_WIDTH - CURSOR_OFFSET;
      if (finalLeft < 0) finalLeft = 0;
    }

    // Check vertical
    if (finalTop + DIALOG_MAX_HEIGHT_PX > viewportHeight) {
      finalTop = y - DIALOG_MAX_HEIGHT_PX - CURSOR_OFFSET;
    }
    if (finalTop < 0) finalTop = 0;
    
    Object.assign(d.style, {
      position: 'fixed',
      left: `${finalLeft}px`,
      top: `${finalTop}px`,
      width: `${DIALOG_WIDTH}px`,
      maxHeight: `${DIALOG_MAX_HEIGHT_VH}vh`, 
      maxWidth: '90vw', 
      zIndex: 2147483647,
      background: 'rgba(20, 20, 20, 0.95)',
      border: '1px solid rgba(255, 255, 255, 0.1)',
      borderRadius: '8px',
      boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
      padding: '12px',
      boxSizing: 'border-box',
      fontFamily: 'system-ui, sans-serif',
      color: '#eee',
      backdropFilter: 'blur(10px)',
      // --- THIS IS THE FIX (Part 2) ---
      // Make the dialog a flex container
      display: 'flex',
      flexDirection: 'column',
    });

    // 4. Center content *only* if it's an error/loading message
    const contentDiv = d.querySelector(`#${CONTENT_ID}`);
    if (!Array.isArray(response) || response.length === 0) {
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

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

})();

