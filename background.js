// The URL of our Python backend server.
const YOUR_BACKEND_URL = 'http://localhost:5000/ocr-and-translate';

// --- Event Listener 1: The Main Message Handler ---
// This listens for messages from *any* content script.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  
  // We only care about messages with the action "captureAndAnalyze"
  if (message.action === "captureAndAnalyze") {
    
    // Step 1: Take the screenshot. This is an async call.
    // 'dataUrl' is a giant base64 string ("data:image/png;base64,...")
    chrome.tabs.captureVisibleTab(null, { format: "png" }, (dataUrl) => {
      if (!dataUrl) {
        // Handle failure (e.g., user is on a protected "chrome://" page)
        sendResponse({ error: "Failed to capture tab" });
        return;
      }

      // --- Step 2: 1:1 Image Crop (The "Blurry" Fix) ---
      // This logic crops a crisp 400x400 square from the
      // screenshot, centered on the cursor, with no scaling.
      
      const CROP_SIZE = 400; // We'll grab a 400x400 physical pixel crop
      const OUTPUT_CANVAS_SIZE = CROP_SIZE;

      // We must load the dataUrl into an image object.
      // In a service worker, the best way is fetch -> blob -> createImageBitmap
      fetch(dataUrl)
        .then(res => res.blob())
        .then(blob => createImageBitmap(blob))
        .then(imageBitmap => {
          
          // Create a temporary, in-memory canvas
          let canvas = new OffscreenCanvas(OUTPUT_CANVAS_SIZE, OUTPUT_CANVAS_SIZE);
          let ctx = canvas.getContext("2d");

          // --- The Coordinate Math ---
          // Convert the logical (e.g., 100) cursor coordinates from the
          // content script into physical (e.g., 150) screenshot coordinates.
          const x_phys = message.x * message.pixelRatio;
          const y_phys = message.y * message.pixelRatio;

          // Find the top-left corner (sx, sy) of our 400x400 crop box
          // by subtracting half the crop size from the cursor's position.
          const sx = x_phys - (CROP_SIZE / 2);
          const sy = y_phys - (CROP_SIZE / 2);

          // --- The Crop ---
          // This single drawImage call performs the crop:
          ctx.drawImage(
            imageBitmap,     // 1. The full screenshot
            sx, sy,          // 2. The top-left (x,y) of the source rectangle
            CROP_SIZE, CROP_SIZE, // 3. The width/height of the source rectangle
            0, 0,            // 4. The top-left (x,y) of the destination canvas
            OUTPUT_CANVAS_SIZE, OUTPUT_CANVAS_SIZE // 5. The width/height to draw
          );

          // Get the new, small image as a Blob
          return canvas.convertToBlob({ type: "image/png" });
        })
        .then(blob => {
          // --- Step 3: Convert Cropped Image to Base64 ---
          // We must convert the Blob back to a base64 string
          // so we can send it as JSON to our Python server.
          let reader = new FileReader();
          reader.onload = () => {
            const croppedDataUrl = reader.result; // Our new, small base64 string
            
            // --- Step 4: Call the Python Backend ---
            // We use fetch() to send the data to our Flask server.
            fetch(YOUR_BACKEND_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              // The payload (body) is a JSON string.
              body: JSON.stringify({
                image_data: croppedDataUrl // Just the image, nothing else
              })
            })
            .then(response => response.json()) // Parse the JSON response
            .then(data => {
              // --- Step 5: Send the Result Home ---
              // 'data' is the list of results from Python.
              // We send it back to the original content_script.js callback.
              sendResponse(data);
            })
            .catch(error => {
              // Handle backend errors (e.g., server is off)
              console.error('Backend error:', error);
              sendResponse({ error: "Backend server is offline." });
            });
          };
          reader.readAsDataURL(blob);
        })
        .catch(error => {
            // Handle image processing errors
            console.error('Image processing error:', error);
            sendResponse({ error: "Failed to process screenshot" });
        });
    });

    // --- CRITICAL ---
    // We MUST return 'true' from the onMessage listener.
    // This tells Chrome that we are sending our response *asynchronously*
    // (i.e., we're waiting for fetch/FileReader). If we don't return
    // true, the message port closes, and sendResponse() fails.
    return true; 
  }
});

