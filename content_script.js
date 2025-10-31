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

      // --- NEW LOGIC ---
      // Check if Alt key is also pressed
      const orientation = e.ctrlKey ? "vertical" : "horizontal";
      // --- END NEW LOGIC ---

      showDialog(mouseX, mouseY); 
      updateDialog(`⏳ Analyzing (${orientation})...`); // Show the mode
      
      chrome.runtime.sendMessage({
        action: "captureAndAnalyze",
        x: mouseX,
        y: mouseY,
        pixelRatio: window.devicePixelRatio,
        orientation: orientation // Pass the new flag
      }, (response) => {
        if (!isVisible) return; 

        if (response && response.text) {
          const formattedHtml = `
            <div style="font-size: 24px; margin-bottom: 8px; color: #eee; word-wrap: break-word;">${escapeHtml(response.furigana)}</div>
            <div style="font-size: 18px; color: #fff; word-wrap: break-word;">${escapeHtml(response.text)}</div>
            <hr style="border: 0; border-top: 1px solid #444; margin: 12px 0;">
            <div style="font-size: 16px; color: #ccc; white-space: pre-wrap; word-wrap: break-word;">${escapeHtml(response.translation)}</div>
          `;
          updateDialogHtml(formattedHtml);
        } else {
          updateDialog(response.error || "❌ Analysis failed.");
        }
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
   * Creates and displays the dialog with a default loading state.
   */
  function showDialog(x, y) {
    hideDialog();
    const d = document.createElement('div');
    d.id = DIALOG_ID;
    
    d.innerHTML = `
      <h3 style="margin:0 0 8px 0; font-size:16px; text-align:center; color: #888;">AlphaOCR</h3>
      <div id="${CONTENT_ID}" style="white-space:pre-wrap; overflow:auto; height:calc(100% - 34px); display: flex; align-items: center; justify-content: center; color: #aaa;">
        ⏳ Capturing...
      </div>
    `;
    
    Object.assign(d.style, {
      position: 'fixed',
      left: `${x + 12}px`,
      top: `${y + 12}px`,
      width: '300px',
      minHeight: '200px',
      maxHeight: '400px',
      zIndex: 2147483647,
      background: 'rgba(20, 20, 20, 0.95)',
      border: '1px solid rgba(255, 255, 255, 0.1)',
      borderRadius: '8px',
      boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
      padding: '12px',
      boxSizing: 'border-box',
      fontFamily: 'system-ui, sans-serif',
      fontSize: '14px',
      color: '#eee',
      overflow: 'hidden',
      backdropFilter: 'blur(10px)',
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
    const container = document.getElementById(CONTENT_ID);
    if (container) {
      container.textContent = text || '...';
      Object.assign(container.style, {
         display: 'flex',
         alignItems: 'center',
         justifyContent: 'center',
         whiteSpace: 'pre-wrap'
      });
    }
  }

  function updateDialogHtml(html) {
    const container = document.getElementById(CONTENT_ID);
    if (container) {
      container.innerHTML = html;
       Object.assign(container.style, {
         display: 'block',
         alignItems: 'initial',
         justifyContent: 'initial',
         whiteSpace: 'pre-wrap'
      });
    }
  }

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

})();

