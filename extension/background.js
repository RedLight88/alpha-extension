// background.js — AlphaOCR service worker

console.log("AlphaOCR background service worker running");

const OCR_ENDPOINT = "http://127.0.0.1:5000/ocr-and-translate";

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

    fetch(OCR_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_data: message.src }),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Server error: ${res.status}`);
        const data = await res.json();
        console.log("✅ OCR result:", data);

        const text = formatOcrResults(data);
        if (sender.tab && sender.tab.id >= 0) {
          chrome.tabs.sendMessage(sender.tab.id, { action: "setTranslation", text });
        }
        sendResponse({ ok: true, text });
      })
      .catch((err) => {
        console.error("❌ OCR fetch failed:", err);
        if (sender.tab && sender.tab.id >= 0) {
          chrome.tabs.sendMessage(sender.tab.id, {
            action: "setTranslation",
            text: "❌ Backend not responding",
          });
        }
        sendResponse({ ok: false, error: String(err) });
      });

    return true; // async sendResponse
  }
});
