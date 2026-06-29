# AlphaOCR

A Chrome extension + local Python backend that lets you **snip a region of any web page,
OCR the Japanese text in it, and look it up on Jisho** — useful for reading manga, games, or
images where the text isn't selectable.

## How it works

```
┌─────────────────────────┐        ┌──────────────────────────┐
│ Chrome extension (MV3)  │        │ Flask backend (app.py)    │
│  content_script.js      │        │                           │
│   • Shift → snip         │ image  │  /ocr-and-translate       │
│   • crop selection ──────┼───────►│   • MangaOcr (image→text) │
│  background.js           │  JSON  │   • Jisho lookup          │
│   • captureVisibleTab ◄──┼────────┤  /health                  │
│  popup.html/js (status) │        │                           │
└─────────────────────────┘        └──────────────────────────┘
```

The extension captures pixels (via `captureVisibleTab`), so it works on `<canvas>`, CSS
backgrounds, and baked-in image text — not just `<img>` tags.

## Setup

### 1. Backend

```bash
python -m venv venv
venv\Scripts\activate        # Windows  (use: source venv/bin/activate on macOS/Linux)
pip install -r requirements.txt
python app.py
```

The first run downloads the MangaOcr model (a few hundred MB). Wait for `Backend ready`.
The server binds to `127.0.0.1:5000` only.

Environment variables (all optional): `ALPHAOCR_HOST`, `ALPHAOCR_PORT`, `ALPHAOCR_DEBUG=1`
(saves `debug_cropped_image.png` per request), `ALPHAOCR_JISHO_TIMEOUT`.

### 2. Extension

1. Open `chrome://extensions`, enable **Developer mode**.
2. **Load unpacked** → select the **`extension/`** subfolder (not the repo root, which contains
   the Python backend).
3. Accept the all-sites permission (needed for screen capture).

### 3. (Optional) "Start backend" button

By default you start the backend yourself (`python app.py`). To launch it from the toolbar
popup's **Start** button instead, register the native-messaging launcher once:

1. Copy your extension's ID from `chrome://extensions` (the 32-letter string on the AlphaOCR card).
2. In PowerShell, from the repo root:
   ```powershell
   powershell -ExecutionPolicy Bypass -File native_host\register_native_host.ps1 -ExtensionId <YOUR_ID>
   ```
   (Add `-Browser Edge` or `-Browser Brave` if you don't use Chrome.)
3. Reopen the popup and click **Start** — the helper launches `app.py` detached (logs to
   `backend.log`) and the popup polls until the model is ready.

A browser extension cannot start a local process on its own; this small registered helper
(`native_host/`) is the supported mechanism. It launches the backend on demand, so the OCR
model only uses memory while you're actually running it.

## Usage

1. Start the backend (the popup's **Backend** row shows ✅ Running when it's reachable).
2. Turn on the **Enable snipping** toggle in the popup (the toolbar icon shows an **ON** badge).
   While off, **Shift** behaves completely normally.
3. Press **Shift**, then **drag a box** over the Japanese text.
4. Release — the recognized text and its translation appear near the selection.
   Press **Escape** to cancel a selection or close the result.

## Notes / limitations

- OCR runs on the whole selected region and the recognized text is looked up on Jisho as a
  single unit. Per-word breakdown of multi-word phrases would require a Japanese tokenizer
  (e.g. fugashi or SudachiPy) and is not yet implemented.
- Screen capture does not work on restricted pages (`chrome://`, the Chrome Web Store, PDF viewer).
