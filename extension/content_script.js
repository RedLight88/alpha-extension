(() => {
  console.log('AlphaOCR content script loaded');

  const DIALOG_ID = 'alphaocr-dialog-unique-01';
  const OVERLAY_ID = 'alphaocr-snip-overlay';
  const SELECTION_ID = 'alphaocr-snip-selection';

  let lastResults = null;   // structured OCR results (array) of the last snip
  let cachedDecks = null;   // Anki deck names, fetched lazily and reused
  let snipping = false;
  let startX = 0, startY = 0;
  let enabled = false; // gated by the toolbar toggle (chrome.storage 'enabled')

  // Load the toggle state and keep it live across changes from the popup.
  chrome.storage.local.get({ enabled: false }, ({ enabled: e }) => { enabled = e; });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.enabled) enabled = changes.enabled.newValue;
  });

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

    // A fresh snip: drop the previous result and place the dialog below the box.
    lastResults = null;
    showDialog(rect.x, rect.y + rect.h + 8);
    setStatus('⏳ Capturing…');

    chrome.runtime.sendMessage({ action: 'snip' }, (response) => {
      if (chrome.runtime.lastError || !response || !response.screenshot) {
        setStatus('❌ Failed to capture screenshot');
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

      setStatus('⏳ Sending for OCR…');
      chrome.runtime.sendMessage({ action: 'ocrImage', src: cropped }, (response) => {
        if (chrome.runtime.lastError) {
          setStatus('❌ Failed to reach OCR backend');
        }
        // The final result also arrives via the setTranslation broadcast.
        if (response && response.ok === false) {
          setStatus('❌ OCR failed');
        }
      });
    };
    img.onerror = () => setStatus('❌ Failed to load screenshot');
    img.src = screenshotDataUrl;
  }

  // ---- Result dialog (isolated in a Shadow DOM so page CSS can't leak in) ----

  const DIALOG_STYLES = `
    :host { all: initial; }
    .panel {
      display: flex; flex-direction: column;
      width: max-content; min-width: 200px;
      max-width: min(380px, 90vw); max-height: min(70vh, 480px);
      background: #fff; color: #111;
      border: 1px solid rgba(0,0,0,0.2); border-radius: 8px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.25);
      box-sizing: border-box;
      font-family: system-ui, sans-serif; font-size: 14px;
      overflow: hidden;
    }
    .hdr {
      margin: 0; padding: 8px 12px; font-size: 15px; font-weight: 600;
      text-align: center; cursor: move; user-select: none;
      border-bottom: 1px solid #eee;
    }
    .body { padding: 8px 12px; overflow: auto; flex: 1 1 auto; }
    .status { color: #444; white-space: pre-wrap; }
    .context {
      font-weight: 600; padding-bottom: 6px; margin-bottom: 6px;
      border-bottom: 1px dashed #ddd; white-space: pre-wrap;
    }
    .words { display: flex; flex-direction: column; gap: 4px; }
    .word { display: flex; align-items: baseline; gap: 8px; cursor: pointer; }
    .word input { margin: 0; flex: 0 0 auto; align-self: center; }
    .word .wtext { white-space: pre-wrap; }
    .footer {
      border-top: 1px solid #eee; padding: 8px 12px;
      display: flex; flex-direction: column; gap: 8px;
    }
    .footer.hidden { display: none; }
    .deck-row { display: flex; gap: 6px; align-items: center; }
    .deck { flex: 1 1 auto; min-width: 0; padding: 4px; font: inherit; }
    button {
      cursor: pointer; font: inherit; border-radius: 6px; padding: 5px 10px;
      border: 1px solid #2e7d32; background: #2e7d32; color: #fff;
    }
    button.secondary { background: #fff; color: #2e7d32; }
    button:disabled { background: #bbb; border-color: #bbb; color: #fff; cursor: default; }
    .newdeck-form { display: flex; gap: 6px; }
    .newdeck-form[hidden] { display: none; }
    .newdeck-input { flex: 1 1 auto; min-width: 0; padding: 4px; font: inherit; }
    .anki-status { font-size: 12px; color: #555; white-space: pre-wrap; }
    .add { align-self: stretch; }
  `;

  function showDialog(x, y) {
    hideDialog();

    const host = document.createElement('div');
    host.id = DIALOG_ID;
    Object.assign(host.style, {
      position: 'fixed', left: `${x}px`, top: `${y}px`,
      zIndex: 2147483647, margin: '0', padding: '0', display: 'block',
    });
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>${DIALOG_STYLES}</style>
      <div class="panel">
        <div class="hdr">Translation</div>
        <div class="body">
          <div class="status"></div>
          <div class="context" hidden></div>
          <div class="words"></div>
        </div>
        <div class="footer hidden">
          <div class="deck-row">
            <select class="deck"></select>
            <button class="newdeck secondary" type="button">+ New deck</button>
          </div>
          <div class="newdeck-form" hidden>
            <input class="newdeck-input" type="text" placeholder="New deck name" />
            <button class="newdeck-confirm" type="button">Create</button>
            <button class="newdeck-cancel secondary" type="button">Cancel</button>
          </div>
          <button class="add" type="button">Add to Anki</button>
          <div class="anki-status"></div>
        </div>
      </div>
    `;

    document.documentElement.appendChild(host);
    wireFooter(shadow);
    clampToViewport(host, x, y);
    makeDraggable(host, shadow.querySelector('.hdr'));

    if (lastResults) renderResults(lastResults);
    else setStatus('No text yet');
  }

  function getShadow() {
    const host = document.getElementById(DIALOG_ID);
    return host ? host.shadowRoot : null;
  }

  // Show a transient/status message and hide the word list + footer.
  function setStatus(text) {
    const shadow = getShadow();
    if (!shadow) return;
    shadow.querySelector('.status').textContent = text == null ? '' : String(text);
    shadow.querySelector('.context').hidden = true;
    shadow.querySelector('.words').textContent = '';
    shadow.querySelector('.footer').classList.add('hidden');
    reclamp();
  }

  // Render the structured OCR results: context line + per-word checkboxes + Anki footer.
  function renderResults(results) {
    lastResults = results;
    const shadow = getShadow();
    if (!shadow) return;

    // An error/empty payload (e.g. [{error}]) — just show its text.
    if (!Array.isArray(results) || results.length === 0 || results[0].error) {
      const msg = (results && results[0] && results[0].error) || '⚠️ No text detected';
      setStatus(msg);
      return;
    }

    shadow.querySelector('.status').textContent = '';

    const context = shadow.querySelector('.context');
    context.textContent = results[0].text || '';
    context.hidden = !context.textContent;

    const wordsEl = shadow.querySelector('.words');
    wordsEl.textContent = '';
    results.forEach((entry, i) => {
      if (i === 0 || entry.error || !entry.text) return;
      const label = document.createElement('label');
      label.className = 'word';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = true;
      cb.dataset.i = String(i);

      const span = document.createElement('span');
      span.className = 'wtext';
      const furi = entry.furigana && entry.furigana !== entry.text ? `（${entry.furigana}）` : '';
      const trans = entry.translation ? ` — ${entry.translation}` : '';
      span.textContent = `${entry.text}${furi}${trans}`;

      label.appendChild(cb);
      label.appendChild(span);
      wordsEl.appendChild(label);
    });

    const hasWords = wordsEl.children.length > 0;
    shadow.querySelector('.footer').classList.toggle('hidden', !hasWords);
    if (hasWords) {
      cachedDecks = null; // refresh deck list once per successful snip
      loadDecks(shadow);
    }
    reclamp();
  }

  // ---- Anki footer wiring ----

  function wireFooter(shadow) {
    const addBtn = shadow.querySelector('.add');
    const newDeckBtn = shadow.querySelector('.newdeck');
    const form = shadow.querySelector('.newdeck-form');
    const input = shadow.querySelector('.newdeck-input');
    const confirmBtn = shadow.querySelector('.newdeck-confirm');
    const cancelBtn = shadow.querySelector('.newdeck-cancel');

    newDeckBtn.addEventListener('click', () => {
      form.hidden = false;
      input.value = '';
      input.focus();
      reclamp();
    });
    cancelBtn.addEventListener('click', () => { form.hidden = true; reclamp(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); confirmBtn.click(); }
      if (e.key === 'Escape') { e.preventDefault(); cancelBtn.click(); }
    });
    confirmBtn.addEventListener('click', () => createDeck(shadow));
    addBtn.addEventListener('click', () => addToAnki(shadow));
  }

  function loadDecks(shadow) {
    const sel = shadow.querySelector('.deck');
    const ankiStatus = shadow.querySelector('.anki-status');
    const controls = [shadow.querySelector('.add'), shadow.querySelector('.newdeck'), sel];

    const fillSelect = (decks, selected) => {
      sel.textContent = '';
      decks.forEach((d) => {
        const o = document.createElement('option');
        o.value = d; o.textContent = d;
        if (d === selected) o.selected = true;
        sel.appendChild(o);
      });
    };

    if (cachedDecks) {
      fillSelect(cachedDecks);
      controls.forEach((c) => { c.disabled = false; });
      ankiStatus.textContent = cachedDecks.length ? '' : 'No decks yet — create one.';
      return;
    }

    ankiStatus.textContent = 'Loading decks…';
    chrome.runtime.sendMessage({ action: 'getDecks' }, (resp) => {
      if (chrome.runtime.lastError || !resp || !resp.ok) {
        const msg = (resp && resp.error) || 'Anki not running';
        ankiStatus.textContent = `⚠️ ${msg}`;
        controls.forEach((c) => { c.disabled = true; });
        reclamp();
        return;
      }
      cachedDecks = resp.decks || [];
      fillSelect(cachedDecks);
      controls.forEach((c) => { c.disabled = false; });
      ankiStatus.textContent = cachedDecks.length ? '' : 'No decks yet — create one.';
      reclamp();
    });
  }

  function createDeck(shadow) {
    const input = shadow.querySelector('.newdeck-input');
    const form = shadow.querySelector('.newdeck-form');
    const ankiStatus = shadow.querySelector('.anki-status');
    const name = input.value.trim();
    if (!name) { input.focus(); return; }

    ankiStatus.textContent = 'Creating deck…';
    chrome.runtime.sendMessage({ action: 'createDeck', deck: name }, (resp) => {
      if (chrome.runtime.lastError || !resp || !resp.ok) {
        ankiStatus.textContent = `⚠️ ${(resp && resp.error) || 'Could not create deck'}`;
        return;
      }
      if (!cachedDecks) cachedDecks = [];
      if (!cachedDecks.includes(resp.deck)) cachedDecks.push(resp.deck);
      cachedDecks.sort();
      loadDecks(shadow);
      shadow.querySelector('.deck').value = resp.deck;
      form.hidden = true;
      ankiStatus.textContent = `✓ Created “${resp.deck}”`;
      reclamp();
    });
  }

  function addToAnki(shadow) {
    const sel = shadow.querySelector('.deck');
    const addBtn = shadow.querySelector('.add');
    const ankiStatus = shadow.querySelector('.anki-status');

    const deck = sel.value;
    if (!deck) { ankiStatus.textContent = '⚠️ Pick a deck first'; return; }

    const notes = [];
    shadow.querySelectorAll('.word input:checked').forEach((cb) => {
      const entry = lastResults && lastResults[Number(cb.dataset.i)];
      if (entry) notes.push({ word: entry.text, reading: entry.furigana || '', meaning: entry.translation || '' });
    });
    if (notes.length === 0) { ankiStatus.textContent = '⚠️ Select at least one word'; return; }

    addBtn.disabled = true;
    ankiStatus.textContent = 'Adding…';
    chrome.runtime.sendMessage({ action: 'ankiAdd', deck, notes }, (resp) => {
      addBtn.disabled = false;
      if (chrome.runtime.lastError || !resp || !resp.ok) {
        ankiStatus.textContent = `⚠️ ${(resp && resp.error) || 'Failed to add'}`;
        return;
      }
      const skipped = resp.skipped ? ` (${resp.skipped} duplicate${resp.skipped > 1 ? 's' : ''} skipped)` : '';
      ankiStatus.textContent = `✓ Added ${resp.added}${skipped}`;
      reclamp();
    });
  }

  // Keep the whole dialog on screen given its current rendered size.
  function clampToViewport(host, desiredLeft, desiredTop) {
    const margin = 8;
    const maxLeft = Math.max(margin, window.innerWidth - host.offsetWidth - margin);
    const maxTop = Math.max(margin, window.innerHeight - host.offsetHeight - margin);
    host.style.left = `${Math.min(Math.max(margin, desiredLeft), maxLeft)}px`;
    host.style.top = `${Math.min(Math.max(margin, desiredTop), maxTop)}px`;
  }

  // Re-clamp using the dialog's current position (content/size may have changed).
  function reclamp() {
    const host = document.getElementById(DIALOG_ID);
    if (host) clampToViewport(host, host.offsetLeft, host.offsetTop);
  }

  // Let the user drag the dialog around by its header.
  function makeDraggable(host, handle) {
    if (!handle) return;
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const startMouseX = e.clientX;
      const startMouseY = e.clientY;
      const origLeft = host.offsetLeft;
      const origTop = host.offsetTop;

      const onMove = (ev) => clampToViewport(host, origLeft + (ev.clientX - startMouseX), origTop + (ev.clientY - startMouseY));
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

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (!message || typeof message !== 'object') return;
      if (message.action === 'setTranslation') {
        // Open the dialog if a snip didn't already (e.g. broadcast after teardown).
        if (!document.getElementById(DIALOG_ID)) showDialog(20, 20);
        if (Array.isArray(message.results)) renderResults(message.results);
        else setStatus(message.text);
        sendResponse && sendResponse({ ok: true });
      }
      return true;
    });
  }
})();
