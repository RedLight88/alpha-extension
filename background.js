const YOUR_BACKEND_URL = 'http://localhost:5000/ocr-and-translate';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "captureAndAnalyze") {
    // Take the screenshot
    chrome.tabs.captureVisibleTab(null, { format: "png" }, (dataUrl) => {
      if (!dataUrl) {
        sendResponse({ error: "Failed to capture tab" });
        return;
      }
      
      // Send screenshot, coordinates, and pixelRatio to the backend
      fetch(YOUR_BACKEND_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_data: dataUrl,
          x: message.x,
          y: message.y,
          pixelRatio: message.pixelRatio // <-- THIS IS THE FIX
        })
      })
      .then(response => response.json())
      .then(data => {
        // 'data' is the full object: { text, furigana, translation }
        sendResponse(data); 
      })
      .catch(error => {
        console.error('Backend error:', error);
        sendResponse({ error: error.message });
      });
    });

    return true; // Keep the message channel open for the async response
  }
});