const YOUR_BACKEND_URL = 'http://localhost:5000/ocr-and-translate';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "captureAndAnalyze") {
    
    chrome.tabs.captureVisibleTab(null, { format: "png" }, (dataUrl) => {
      if (!dataUrl) {
        sendResponse({ error: "Failed to capture tab" });
        return;
      }

      // --- NEW 1:1 CROP LOGIC ---
      
      // 1. Define the crop size. We want a 400x400px final image.
      const CROP_SIZE = 400;

      // 2. Use fetch and createImageBitmap to load the screenshot
      fetch(dataUrl)
        .then(res => res.blob())
        .then(blob => createImageBitmap(blob))
        .then(imageBitmap => {
          
          // 3. Create a canvas that is the *exact* size of our desired crop.
          let canvas = new OffscreenCanvas(CROP_SIZE, CROP_SIZE);
          let ctx = canvas.getContext("2d");

          // 4. Calculate the *physical* crop coordinates
          const x_phys = message.x * message.pixelRatio;
          const y_phys = message.y * message.pixelRatio;

          // Define the source rectangle (sWidth/sHeight)
          // This is a 1:1 copy, so sWidth and sHeight are the same as the canvas size.
          const sWidth = CROP_SIZE;
          const sHeight = CROP_SIZE;

          // Find the top-left corner (sx, sy) of the source crop box
          const sx = x_phys - (sWidth / 2);
          const sy = y_phys - (sHeight / 2);

          // 5. Draw the 1:1 cropped image to the canvas
          // No scaling, no zooming. Just a direct copy.
          ctx.drawImage(
            imageBitmap,     // Source image (full screenshot)
            sx, sy,          // Source rect (sx, sy)
            sWidth, sHeight, // Source rect (sWidth, sHeight)
            0, 0,            // Destination rect (dx, dy)
            CROP_SIZE, CROP_SIZE // Destination rect (dWidth, dHeight)
          );

          // --- END NEW LOGIC ---

          return canvas.convertToBlob({ type: "image/png" });
        })
        .then(blob => {
          let reader = new FileReader();
          reader.onload = () => {
            const croppedDataUrl = reader.result; // This is our crisp, 400x400 base64 image
            
            // 8. Send the crisp, cropped image to the backend
            fetch(YOUR_BACKEND_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                image_data: croppedDataUrl,
                orientation: message.orientation
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

    return true; // Keep the message channel open for the async response
  }
});

