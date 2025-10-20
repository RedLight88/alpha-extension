// background.js — AlphaOCR service worker

console.log("AlphaOCR background service worker running");

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Validate message
  if (!message || message.action !== "ocrImage" || !message.src) return;

  console.log("📩 Received OCR request from content script");

  // Extract the base64 data from "data:image/png;base64,...."
  const base64Data = message.src.split(",")[1];
  if (!base64Data) {
    sendResponse({ text: "❌ Invalid image data" });
    return;
  }

  // Send request to local Python backend
  fetch("http://127.0.0.1:5000/ocr", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ image: base64Data })
  })
    .then(async (res) => {
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const data = await res.json();
      console.log("✅ OCR result:", data);

      // Send message back to the same tab (content script)
      if (sender.tab && sender.tab.id >= 0) {
        chrome.tabs.sendMessage(sender.tab.id, {
          action: "setTranslation",
          text: data.text || "⚠️ No text detected"
        });
      }

      sendResponse({ ok: true });
    })
    .catch((err) => {
      console.error("❌ OCR fetch failed:", err);
      if (sender.tab && sender.tab.id >= 0) {
        chrome.tabs.sendMessage(sender.tab.id, {
          action: "setTranslation",
          text: "❌ Backend not responding"
        });
      }
      sendResponse({ ok: false, error: String(err) });
    });

  // Required for async sendResponse in service workers
  return true;
});
