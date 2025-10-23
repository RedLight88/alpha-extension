const YOUR_BACKEND_URL = 'http://localhost:5000/ocr-and-translate';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "captureAndAnalyze") {
    // 3. Take the screenshot
    chrome.tabs.captureVisibleTab(null, { format: "png" }, (dataUrl) => {
      if (!dataUrl) {
        sendResponse({ error: "Failed to capture tab" });
        return;
      }
      
      // 4. Send screenshot (dataUrl) AND coordinates to your Python backend
      fetch(YOUR_BACKEND_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_data: dataUrl, // This is a base64 string
          x: message.x,         // Cursor X coordinate
          y: message.y          // Cursor Y coordinate
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
  
  // Keep your old 'ocrImage' listener if you still want to support clicking <img> tags
});