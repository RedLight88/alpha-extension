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

  // Toggle popup with Shift
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Shift') {
      // Don't trigger if we're typing in an input
      if (isTypingArea(document.activeElement)) return;
      
      if (isVisible) {
        hideDialog();
        return; // Exit after hiding
      }

      // Show dialog and immediately request analysis
      showDialog(mouseX, mouseY); // This will show "Loading..."
      
      chrome.runtime.sendMessage({
        action: "captureAndAnalyze",
        x: mouseX,
        y: mouseY
      }, (response) => {
        // Check if dialog is still visible (user might have hidden it)
        if (!isVisible) return; 

        if (response && response.text) {
          // Build the rich HTML from the backend response
          const formattedHtml = `
            <div style="font-size: 24px; margin-bottom: 8px; color: #eee; word-wrap: break-word;">${escapeHtml(response.furigana)}</div>
            <div style="font-size: 18px; color: #fff; word-wrap: break-word;">${escapeHtml(response.text)}</div>
            <hr style="border: 0; border-top: 1px solid #444; margin: 12px 0;">
            <div style="font-size: 16px; color: #ccc; white-space: pre-wrap; word-wrap: break-word;">${escapeHtml(response.translation)}</div>
          `;
          updateDialogHtml(formattedHtml);
        } else {
          // Handle errors from the backend or capture
          updateDialog(response.error || "❌ Analysis failed.");
        }
      });
    }
    
    // Hide with Escape key
    if (e.key === 'Escape' && isVisible) {
      hideDialog();
    }
  }, true);

  // Hide when clicking outside the dialog
  document.addEventListener('mousedown', (e) => {
    if (!isVisible) return;
    const dialog = document.getElementById(DIALOG_ID);
    // If the click is outside the dialog, hide it
    if (dialog && !dialog.contains(e.target)) {
      hideDialog();
    }
  }, true);

  /**
   * Creates and displays the dialog with a default loading state.
   */
  function showDialog(x, y) {
    hideDialog(); // Ensure only one dialog exists
    const d = document.createElement('div');
    d.id = DIALOG_ID;
    
    // Default "Loading" state
    d.innerHTML = `
      <h3 style="margin:0 0 8px 0; font-size:16px; text-align:center; color: #888;">AlphaOCR</h3>
      <div id="${CONTENT_ID}" style="white-space:pre-wrap; overflow:auto; height:calc(100% - 34px); display: flex; align-items: center; justify-content: center; color: #aaa;">
        ⏳ Capturing & Analyzing...
      </div>
    `;
    
    // Apply styles
    Object.assign(d.style, {
      position: 'fixed',
      left: `${x + 12}px`,
      top: `${y + 12}px`,
      width: '300px',
      minHeight: '200px',
      maxHeight: '400px',
      zIndex: 2147483647,
      background: 'rgba(20, 20, 20, 0.95)', // Dark, slightly transparent
      border: '1px solid rgba(255, 255, 255, 0.1)',
      borderRadius: '8px',
      boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
      padding: '12px',
      boxSizing: 'border-box',
      fontFamily: 'system-ui, sans-serif',
      fontSize: '14px',
      color: '#eee', // Default text color
      overflow: 'hidden',
      backdropFilter: 'blur(10px)', // Frosted glass effect
    });
    document.documentElement.appendChild(d);
    isVisible = true;
  }

  /**
   * Removes the dialog from the DOM.
   */
  function hideDialog() {
    const existing = document.getElementById(DIALOG_ID);
    if (existing) existing.remove();
    isVisible = false;
  }

  /**
   * Checks if the active element is a text input area.
   */
  function isTypingArea(el) {
    if (!el) return false;
    const tag = (el.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') return true;
    if (el.isContentEditable) return true;
    return false;
  }

  /**
   * Updates dialog content with plain text (for loading/errors).
   */
  function updateDialog(text) {
    const container = document.getElementById(CONTENT_ID);
    if (container) {
      container.textContent = text || '...';
      // Re-center text for loading/error messages
      Object.assign(container.style, {
         display: 'flex',
         alignItems: 'center',
         justifyContent: 'center',
         whiteSpace: 'pre-wrap'
      });
    }
  }

  /**
   * Updates dialog content with rich HTML (for results).
   */
  function updateDialogHtml(html) {
    const container = document.getElementById(CONTENT_ID);
    if (container) {
      container.innerHTML = html;
      // Set to normal block display for formatted results
       Object.assign(container.style, {
         display: 'block',
         alignItems: 'initial',
         justifyContent: 'initial',
         whiteSpace: 'pre-wrap'
      });
    }
  }

  /**
   * Sanitizes a string for safe insertion into innerHTML.
   */
  function escapeHtml(str) {
    if (str == null) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

})();