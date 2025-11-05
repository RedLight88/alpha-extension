// We wrap the entire script in an "Immediately Invoked Function Expression" (IIFE)
// to prevent our variables (like DIALOG_ID, mouseX) from polluting the
// global scope of the webpage it's injected into.
(() => {
  console.log('AlphaOCR content script loaded');

  // --- Constants ---
  // We define unique IDs for our DOM elements to avoid conflicts
  // with the webpage's own HTML.
  const DIALOG_ID = 'alphaocr-dialog-unique-01';
  const CONTENT_ID = 'alphaocr-content';

  // --- State Variables ---
  let mouseX = 0, mouseY = 0; // Tracks the cursor's last (logical) X/Y position
  let isVisible = false;      // A simple boolean to track if our dialog is open

  // --- Event Listener 1: Mouse Tracking ---
  // This listener constantly updates the (mouseX, mouseY) variables.
  // We use { capture: true, passive: true } for performance:
  // - capture: Catches the event early.
  // - passive: Tells the browser this listener won't block scrolling.
  document.addEventListener('mousemove', (e) => {
    mouseX = e.clientX; // clientX/Y are logical pixel coordinates
    mouseY = e.clientY;
  }, { capture: true, passive: true });

  // --- Event Listener 2: The Main "Shift" Key Press ---
  // This is the main trigger for the entire application.
  document.addEventListener('keydown', (e) => {
    // We only care about the "Shift" key
    if (e.key === 'Shift') {
      
      // --- Guard Clauses (Conditions to abort) ---
      // 1. If the user is typing in an input, don't trigger.
      if (isTypingArea(document.activeElement)) return;
      // 2. If the dialog is already visible, "Shift" acts as a toggle to close it.
      if (isVisible) {
        hideDialog();
        return;
      }

      // We do NOT show the dialog yet. We just send the message.
      
      // Send a message to our background.js service worker.
      // This is an async call.
      chrome.runtime.sendMessage({
        // The payload (the data we send):
        action: "captureAndAnalyze",     // A string to identify the command
        x: mouseX,                       // The last known cursor X
        y: mouseY,                       // The last known cursor Y
        pixelRatio: window.devicePixelRatio // The screen's zoom/scaling factor
      }, (response) => {
        // --- The Callback ---
        // This function runs MUCH later, only *after* the background
        // script and Python server have finished and sent a response.
        
        // A safety check: if the user hid the dialog while we were
        // loading, don't show a new one.
        if (isVisible) return; 
        
        // NOW we can finally show the dialog, passing in the
        // backend's response to be rendered immediately.
        showDialog(mouseX, mouseY, response);
      });
    }
    
    // A simple listener to close the dialog with the "Escape" key
    if (e.key === 'Escape' && isVisible) {
      hideDialog();
    }
  }, true); // Use capture: true to get the keydown event first

  // --- Event Listener 3: Click Outside ---
  // This listener hides the dialog if the user clicks anywhere else.
  document.addEventListener('mousedown', (e) => {
    if (!isVisible) return; // Not visible? Do nothing.
    const dialog = document.getElementById(DIALOG_ID);
    // If a dialog exists AND the click was *outside* of it...
    if (dialog && !dialog.contains(e.target)) {
      hideDialog(); // ...hide it.
    }
  }, true);

  /**
   * Function: showDialog
   * Input: 
   * x (number): The logical mouseX coordinate
   * y (number): The logical mouseY coordinate
   * response (array | object): The final JSON response from the backend.
   * Output: (void) - Creates and injects the dialog into the DOM.
   */
  function showDialog(x, y, response) {
    hideDialog(); // Clean up any old dialogs
    const d = document.createElement('div'); // Create the main dialog <div>
    d.id = DIALOG_ID;

    // This makes the font size responsive to zoom, but with limits.
    // clamp(MIN_SIZE, PREFERRED_SIZE, MAX_SIZE)
    const headerFontSize = "clamp(12px, 1.4vw, 18px)";
    const textFontSize = "clamp(14px, 1.6vw, 19px)";
    const furiganaFontSize = "clamp(11px, 1.2vw, 16px)";
    const translationFontSize = "clamp(12px, 1.4vw, 17px)";
    
    let contentHtml = ''; // This will hold our list of results
    
    // --- Response Rendering ---
    // We check if the response is a valid, non-empty array
    if (Array.isArray(response) && response.length > 0) {
      
      // Use .map() to turn each result object into an HTML string
      contentHtml = response.map(item => {
        // Handle error objects sent from the backend (e.g., Jisho fails)
        if (item.error) {
           return `<div style="font-size: ${translationFontSize}; color: #888;">${escapeHtml(item.error)}</div>`;
        }
        
        // 'white-space: nowrap' forces it to one line.
        // 'overflow: hidden' and 'text-overflow: ellipsis' add the "..."
        // if the translation is too long.
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
      }).join(''); // Join all the HTML strings into one block

    } else {
      // The response was an error (or empty)
      const loadingFontSize = "clamp(14px, 1.5vw, 18px)";
      const errorText = (response && response.error) || "❌ Analysis failed.";
      contentHtml = `<div style="font-size: ${loadingFontSize};">${escapeHtml(errorText)}</div>`;
    }

    // The inner div (#CONTENT_ID) has 'flex: 1' which tells it to
    // grow and fill the available space, which allows 'overflow-y:auto'
    // to work correctly.
    d.innerHTML = `
      <h3 style="margin:0 0 12px 0; text-align:center; color: #888; font-size: ${headerFontSize}; border-bottom: 1px solid #444; padding-bottom: 8px;">AlphaOCR</h3>
      <div id="${CONTENT_ID}" style="flex: 1 1 auto; overflow-y:auto; overflow-x: hidden; padding-right: 5px; min-height: 0;">
        ${contentHtml}
      </div>
    `;

    // --- Dialog Positioning (Boundary Check) ---
    const DIALOG_WIDTH = 350; // Logical width
    const CURSOR_OFFSET = 12;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const DIALOG_MAX_HEIGHT_VH = 80;
    const DIALOG_MAX_HEIGHT_PX = viewportHeight * (DIALOG_MAX_HEIGHT_VH / 100);

    let finalLeft = x + CURSOR_OFFSET;
    let finalTop = y + CURSOR_OFFSET;

    // 1. Flip horizontally if it goes off the right edge
    if (finalLeft + DIALOG_WIDTH > viewportWidth) {
      finalLeft = x - DIALOG_WIDTH - CURSOR_OFFSET;
      if (finalLeft < 0) finalLeft = 0; // Don't let it go off the left
    }
    // 2. Flip vertically if it goes off the bottom edge
    if (finalTop + DIALOG_MAX_HEIGHT_PX > viewportHeight) {
      finalTop = y - DIALOG_MAX_HEIGHT_PX - CURSOR_OFFSET;
    }
    if (finalTop < 0) finalTop = 0; // Don't let it go off the top
    
    // --- Dialog Styling (CSS-in-JS) ---
    Object.assign(d.style, {
      position: 'fixed',
      left: `${finalLeft}px`,
      top: `${finalTop}px`,
      width: `${DIALOG_WIDTH}px`,
      maxHeight: `${DIALOG_MAX_HEIGHT_VH}vh`, // Max 80% of viewport height
      maxWidth: '90vw',                       // Max 90% of viewport width
      zIndex: 2147483647,                     // A high z-index to be on top
      background: 'rgba(20, 20, 20, 0.95)',
      border: '1px solid rgba(255, 255, 255, 0.1)',
      borderRadius: '8px',
      boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
      padding: '12px',
      boxSizing: 'border-box',
      fontFamily: 'system-ui, sans-serif',
      color: '#eee',
      backdropFilter: 'blur(10px)',
      display: 'flex',
      flexDirection: 'column',
    });

    // --- Content Centering ---
    // This centers the "Error" or "Loading" text.
    const contentDiv = d.querySelector(`#${CONTENT_ID}`);
    if (!Array.isArray(response) || response.length === 0) {
      Object.assign(contentDiv.style, {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      });
    }

    // Finally, add the fully-built dialog to the webpage.
    document.documentElement.appendChild(d);
    isVisible = true;
  }

  function hideDialog() {
    const existing = document.getElementById(DIALOG_ID);
    if (existing) {
      existing.remove(); // Remove the element from the webpage
    }
    isVisible = false;
  }

  function isTypingArea(el) {
    if (!el) return false;
    const tag = (el.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') return true;
    if (el.isContentEditable) return true;
    return false;
  }

  function escapeFull(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

})(); // End of the IIFE

