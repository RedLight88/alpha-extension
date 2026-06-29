# AlphaOCR

A Chrome extension + local Python backend that lets you **snip a region of any web page, OCR the
Japanese text in it, and look every word up on Jisho**. Built for reading manga, games, or any image
where the text isn't selectable.

- Press **Shift** and drag a box over Japanese text.
- The extension screenshots that region, sends it to a local OCR server, and shows the recognized
  text plus a per-word dictionary breakdown in a draggable popup.

---

## Contents
- [How it works](#how-it-works)
- [Requirements](#requirements)
- [Repository layout](#repository-layout)
- [Setup](#setup)
  - [1. Backend (Python)](#1-backend-python)
  - [2. Extension (Chrome)](#2-extension-chrome)
  - [3. Optional: "Start backend" button](#3-optional-start-backend-button)
- [Daily usage](#daily-usage)
- [Configuration](#configuration)
- [Troubleshooting](#troubleshooting)
- [Limitations](#limitations)

---

## How it works

```
┌──────────────────────────── Chrome extension (MV3) ───────────────────────────┐
│  content_script.js   Shift+drag → screenshot request → crop → show popup        │
│  background.js        captureVisibleTab; POST crop to backend; relay result      │
│  popup.html/js        toggle snipping on/off; Start/Stop the backend             │
└───────────────────────────────────────┬────────────────────────────────────────┘
                                         │  HTTP (localhost:5000)
                                         ▼
┌──────────────────────────── Python backend (app.py) ──────────────────────────┐
│  /ocr-and-translate   MangaOcr (image→text) → fugashi (split words) → Jisho      │
│  /health  /shutdown   status probe / stop the server                            │
└─────────────────────────────────────────────────────────────────────────────────┘
```

The extension captures **screen pixels** (not the DOM), so it works on `<canvas>`, CSS background
images, and text baked into images — not just `<img>` tags.

A deep, function-by-function technical reference lives in [TECHNICAL.md](TECHNICAL.md).

## Requirements

- **Windows** (the optional launcher scripts are Windows/PowerShell; the rest is cross-platform).
- **Python 3.10+** with `pip`.
- **Google Chrome** (or Edge/Brave — Chromium-based).
- First backend run downloads the MangaOcr model (~400 MB) and a Japanese dictionary.

## Repository layout

```
alpha-extension/
├─ app.py                       # Flask OCR + translation backend
├─ requirements.txt             # Python dependencies
├─ extension/                   # ← load THIS folder in Chrome
│  ├─ manifest.json
│  ├─ background.js             # service worker
│  ├─ content_script.js         # snip UI + result popup
│  ├─ popup.html / popup.js      # toolbar popup
│  └─ icons/
├─ native_host/                 # optional "Start backend" launcher
│  ├─ launch_host.py
│  ├─ alphaocr_launcher.bat
│  ├─ com.alphaocr.launcher.json
│  └─ register_native_host.ps1
├─ README.md
└─ TECHNICAL.md
```

---

## Setup

### 1. Backend (Python)

Open **PowerShell** in the repo root (`alpha-extension/`) and run:

```powershell
# Create and activate a virtual environment
python -m venv venv
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass   # allow activation in this session
.\venv\Scripts\Activate.ps1

# Install dependencies (includes the fugashi tokenizer for per-word lookup)
pip install -r requirements.txt

# Start the server
python app.py
```

Wait for `Backend ready on http://127.0.0.1:5000`. The server binds to **localhost only**.

> Using Command Prompt instead of PowerShell? Activate with `venv\Scripts\activate.bat`.

### 2. Extension (Chrome)

1. Go to `chrome://extensions`.
2. Turn on **Developer mode** (top-right).
3. Click **Load unpacked** and select the **`extension/`** subfolder
   (⚠️ not the repo root — that contains the Python backend).
4. Accept the permission prompt (all-sites access is needed to screenshot pages).

You should see the **AlphaOCR** icon in the toolbar.

### 3. Optional: "Start backend" button

By default you start the backend yourself with `python app.py`. If you'd rather launch it from the
popup's **Start** button, register the native-messaging launcher **once**:

1. Copy your extension ID from `chrome://extensions` (the 32-letter string on the AlphaOCR card).
2. In PowerShell from the repo root:

   ```powershell
   powershell -ExecutionPolicy Bypass -File native_host\register_native_host.ps1 -ExtensionId <YOUR_ID>
   ```

   For Edge or Brave, add `-Browser Edge` or `-Browser Brave`.
3. Reopen the popup → click **Start**. The helper launches `app.py` detached (output goes to
   `backend.log`) and the popup polls until the model is ready.

> A browser extension cannot start a local process on its own — this small registered helper is the
> supported mechanism. It launches the backend on demand, so the OCR model only uses memory while
> you're actually using it.

---

## Daily usage

1. **Start the backend** — either `python app.py`, or the popup's **Start** button (if you set up
   step 3). The popup's **Backend** row shows ✅ Running when it's reachable.
2. **Enable snipping** — flip the **Enable snipping** toggle in the popup. The toolbar icon shows an
   **ON** badge. While off, **Shift** behaves completely normally.
3. **Snip** — press **Shift**, then **drag a box** over the Japanese text and release.
4. **Read** — a popup appears showing the full recognized line and a per-word breakdown
   (`word（reading）— meaning`). **Drag it** by the "Translation" header; press **Escape** to close.
5. **Stop the backend** when done — click **Stop** (the button turns red while running) to free the
   memory the model uses.

## Configuration

The backend reads these environment variables (all optional):

| Variable | Default | Meaning |
|---|---|---|
| `ALPHAOCR_HOST` | `127.0.0.1` | Bind address. Leave as localhost unless you know why. |
| `ALPHAOCR_PORT` | `5000` | Port. |
| `ALPHAOCR_DEBUG` | *(off)* | `1`/`true` enables debug logging and saves `debug_cropped_image.png` per request. |
| `ALPHAOCR_JISHO_TIMEOUT` | `5` | Seconds before a Jisho request times out. |
| `ALPHAOCR_MAX_IMAGE_BYTES` | `10485760` | Max accepted request body (10 MB). |
| `ALPHAOCR_MAX_LOOKUPS` | `20` | Max distinct words looked up per snip. |

Set one for a single run in PowerShell, e.g.:

```powershell
$env:ALPHAOCR_DEBUG = "1"; python app.py
```

## Troubleshooting

- **Popup says "Backend not reachable"** — the server isn't running. Start it (`python app.py` or the
  Start button) and reopen the popup.
- **Shift does nothing** — the **Enable snipping** toggle is off, or you're focused in a text field
  (typing areas are intentionally ignored).
- **"Launcher not set up" when clicking Start** — you haven't run `register_native_host.ps1`, or you
  registered a different/old extension ID. Re-run it with your current ID (step 3).
- **Capture fails on a page** — screenshots don't work on restricted pages (`chrome://*`, the Chrome
  Web Store, the built-in PDF viewer).
- **Stop a manually-started backend** — close its terminal, or run `taskkill /IM python.exe /F`
  (kills all Python processes).
- **Crop looks misaligned** — set `ALPHAOCR_DEBUG=1` and inspect `debug_cropped_image.png`; this is
  usually a browser-zoom / display-scaling edge case.

## Limitations

- Word splitting is **short-unit**: it captures single words and noun+suffix compounds (e.g. 加害者)
  well, but won't merge longer multi-word phrases. That's generally ideal for dictionary lookups.
- Each word triggers a separate Jisho request, so a long line takes a few seconds.
- Per-word lookup needs `fugashi` + `unidic-lite` (installed via `requirements.txt`). Without them the
  backend still runs but looks the whole line up as one entry.
