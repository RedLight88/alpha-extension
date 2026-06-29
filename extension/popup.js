document.addEventListener('DOMContentLoaded', () => {
  const output = document.getElementById('output');
  // Show a quick reachability check for the local OCR backend.
  fetch('http://127.0.0.1:5000/ocr-and-translate', { method: 'OPTIONS' })
    .then(() => {
      output.textContent = '✅ Backend reachable. Press Left Ctrl, then drag a box over Japanese text.';
    })
    .catch(() => {
      output.textContent = '⚠️ Backend not reachable on 127.0.0.1:5000. Start it with: python app.py';
    });
});
