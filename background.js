const YOUR_BACKEND_URL = 'http://localhost:5000/ocr-and-translate';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "captureAndAnalyze") {
    
    chrome.tabs.captureVisibleTab(null, { format: "png" }, (dataUrl) => {
      if (!dataUrl) {
        sendResponse({ error: "Failed to capture tab" });
        return;
      }

      // --- NEW CROP & ZOOM LOGIC ---

      // 1. Define crop/zoom parameters
      const CROP_LOGICAL_SIZE = 150; 
      const ZOOM_FACTOR = 2.5;         
      const OUTPUT_CANVAS_SIZE = CROP_LOGICAL_SIZE * ZOOM_FACTOR; 

      // 2. Use fetch and createImageBitmap to load the screenshot
      fetch(dataUrl)
        .then(res => res.blob())
        .then(blob => createImageBitmap(blob))
        .then(imageBitmap => {
          
          let canvas = new OffscreenCanvas(OUTPUT_CANVAS_SIZE, OUTPUT_CANVAS_SIZE);
          let ctx = canvas.getContext("2d");

          // 4. Calculate the *physical* crop coordinates
          const x_phys = message.x * message.pixelRatio;
          const y_phys = message.y * message.pixelRatio;
          const sWidth = CROP_LOGICAL_SIZE * message.pixelRatio;
          const sHeight = sWidth;
          const sx = x_phys - (sWidth / 2);
          const sy = y_phys - (sHeight / 2);

          // 5. Draw the cropped, zoomed-in image to the canvas
          ctx.drawImage(
            imageBitmap,     
            sx, sy,          
            sWidth, sHeight, 
            0, 0,            
            OUTPUT_CANVAS_SIZE, OUTPUT_CANVAS_SIZE 
          );

          return canvas.convertToBlob({ type: "image/png" });
        })
        .then(blob => {
          let reader = new FileReader();
          reader.onload = () => {
            const zoomedDataUrl = reader.result; 
            
            // 8. Send the small, zoomed image AND the orientation
            fetch(YOUR_BACKEND_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                image_data: zoomedDataUrl,
                orientation: message.orientation // <-- THIS IS THE FIX
              })
            })
            .then(response => response.json())
            .then(data => sendResponse(data))
            .catch(error => {
              console.error('Backend error:', error);
              sendResponse({ error: error.message });
            });
          };
          reader.readAsDataURL(blob);
        })
        .catch(error => {
            console.error('Image processing error:', error);
            sendResponse({ error: "Failed to process screenshot" });
        });
    });

    return true; 
  }
});

