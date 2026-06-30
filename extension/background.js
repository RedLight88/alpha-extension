// background.js — AlphaOCR service worker

console.log("AlphaOCR background service worker running");

// Single source for the backend host:port (see TECHNICAL.md §12).
const BACKEND_BASE = "http://127.0.0.1:5000";
const OCR_ENDPOINT = `${BACKEND_BASE}/ocr-and-translate`;
const ANKI_DECKS_URL = `${BACKEND_BASE}/anki/decks`;
const ANKI_CREATE_DECK_URL = `${BACKEND_BASE}/anki/create-deck`;
const ANKI_ADD_URL = `${BACKEND_BASE}/anki/add`;

const OCR_TIMEOUT_MS = 30000;
const ANKI_TIMEOUT_MS = 10000;

// fetch() with an abort-based timeout so a hung backend can't wedge the dialog.
async function fetchJson(url, options = {}, timeoutMs = ANKI_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = (data && data.error) || `Server error: ${res.status}`;
      throw new Error(msg);
    }
    return data;
  } catch (err) {
    if (err.name === "AbortError") throw new Error("Request timed out");
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// --- Enabled toggle: badge + default state -------------------------------

function updateBadge(enabled) {
  chrome.action.setBadgeText({ text: enabled ? "ON" : "" });
  chrome.action.setBadgeBackgroundColor({ color: "#2e7d32" });
}

// Set the default the first time the extension is installed.
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get({ enabled: false }, ({ enabled }) => updateBadge(enabled));
});

// Keep the badge in sync whenever the toggle changes (from the popup).
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.enabled) {
    updateBadge(changes.enabled.newValue);
  }
});

// The service worker can be torn down and restarted; restore the badge on wake.
chrome.storage.local.get({ enabled: false }, ({ enabled }) => updateBadge(enabled));

// Format the backend's list response into a readable string for the dialog.
// Backend returns [{text, furigana, translation}] or [{error}] (see app.py).
function formatOcrResults(data) {
  if (!Array.isArray(data) || data.length === 0) {
    return "⚠️ No text detected";
  }
  return data
    .map((entry) => {
      if (entry.error) return entry.error;
      const text = entry.text || "";
      const furigana = entry.furigana && entry.furigana !== text ? `（${entry.furigana}）` : "";
      const translation = entry.translation ? ` — ${entry.translation}` : "";
      return `${text}${furigana}${translation}`;
    })
    .join("\n");
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") return;

  // 1) Snip request: screenshot the visible tab and hand the PNG back to the
  //    content script, which crops the selected rectangle.
  if (message.action === "snip") {
    const windowId = sender.tab ? sender.tab.windowId : chrome.windows.WINDOW_ID_CURRENT;
    chrome.tabs.captureVisibleTab(windowId, { format: "png" }, (dataUrl) => {
      if (chrome.runtime.lastError || !dataUrl) {
        console.error("❌ captureVisibleTab failed:", chrome.runtime.lastError);
        sendResponse({ error: chrome.runtime.lastError?.message || "capture failed" });
        return;
      }
      sendResponse({ screenshot: dataUrl });
    });
    return true; // async sendResponse
  }

  // 2) OCR request: POST the cropped data URL to the local Python backend.
  if (message.action === "ocrImage" && message.src) {
    console.log("📩 Received OCR request from content script");

    fetchJson(
      OCR_ENDPOINT,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_data: message.src }),
      },
      OCR_TIMEOUT_MS,
    )
      .then((data) => {
        console.log("✅ OCR result:", data);
        // Pass both the formatted string (fallback) and the structured array so
        // the dialog can render a checkbox per word for Anki export.
        const text = formatOcrResults(data);
        if (sender.tab && sender.tab.id >= 0) {
          chrome.tabs.sendMessage(sender.tab.id, { action: "setTranslation", text, results: data });
        }
        sendResponse({ ok: true, text, results: data });
      })
      .catch((err) => {
        console.error("❌ OCR fetch failed:", err);
        if (sender.tab && sender.tab.id >= 0) {
          chrome.tabs.sendMessage(sender.tab.id, {
            action: "setTranslation",
            text: `❌ ${err.message || "Backend not responding"}`,
          });
        }
        sendResponse({ ok: false, error: String(err) });
      });

    return true; // async sendResponse
  }

  // 3) List Anki decks (for the dialog's deck picker).
  if (message.action === "getDecks") {
    fetchJson(ANKI_DECKS_URL, {}, ANKI_TIMEOUT_MS)
      .then((data) => sendResponse({ ok: true, decks: data.decks || [] }))
      .catch((err) => sendResponse({ ok: false, error: err.message || String(err) }));
    return true;
  }

  // 4) Create a new Anki deck.
  if (message.action === "createDeck" && message.deck) {
    fetchJson(
      ANKI_CREATE_DECK_URL,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deck: message.deck }),
      },
      ANKI_TIMEOUT_MS,
    )
      .then((data) => sendResponse({ ok: true, deck: data.deck }))
      .catch((err) => sendResponse({ ok: false, error: err.message || String(err) }));
    return true;
  }

  // 5) Add the selected words to an Anki deck.
  if (message.action === "ankiAdd" && message.deck && Array.isArray(message.notes)) {
    fetchJson(
      ANKI_ADD_URL,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deck: message.deck, notes: message.notes }),
      },
      ANKI_TIMEOUT_MS,
    )
      .then((data) => sendResponse({ ok: true, added: data.added, skipped: data.skipped }))
      .catch((err) => sendResponse({ ok: false, error: err.message || String(err) }));
    return true;
  }
});
