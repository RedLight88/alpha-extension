# AlphaOCR — Technical Reference

A detailed, function-by-function description of how AlphaOCR works internally. For setup and usage
see [README.md](README.md).

---

## 1. Architecture overview

AlphaOCR has two halves that talk over HTTP on `localhost:5000`:

| Half | Runtime | Responsibility |
|---|---|---|
| **Extension** (`extension/`) | Chrome MV3 | Capture a screen region as a PNG, crop it, render results |
| **Backend** (`app.py`) | Python / Flask | OCR the image, split into words, look each up on Jisho |

A third, optional piece — the **native messaging host** (`native_host/`) — lets the popup launch the
backend process, which an extension cannot do directly.

### Why screen capture (not the DOM)
Manga/game text is usually a `<canvas>`, a CSS `background-image`, or text rasterized into a larger
image. Reading a DOM `<img>` would miss all of those. So the extension uses
`chrome.tabs.captureVisibleTab` to grab the **rendered pixels** of the viewport, then crops the user's
selection out of that screenshot.

---

## 2. End-to-end data flow

```
Shift+drag (content_script)
   │  rect {x,y,w,h} in CSS px, devicePixelRatio
   ▼
{action:'snip'} ──────────────► background.js
                                 captureVisibleTab(png)
   ◄───────────────────────────  {screenshot: dataURL}   (full viewport PNG)
crop rect×dpr onto a <canvas> → toDataURL('image/png')
   │
{action:'ocrImage', src} ─────► background.js
                                 POST /ocr-and-translate {image_data: src}
                                    │
                                    ▼  app.py
                                 decode → MangaOcr → tokenize_words → lookup_jisho×N
                                    │
                                 [{text,furigana,translation}, ...]
   ◄───────────────────────────  formatOcrResults() → string (+ raw array)
{action:'setTranslation', text, results} ► content_script.renderResults()  (popup)

Then, optionally, from the popup's Anki footer:
{action:'getDecks'}   ─► background ─► GET  /anki/decks       ─► AnkiConnect deckNames
{action:'createDeck'} ─► background ─► POST /anki/create-deck ─► AnkiConnect createDeck
{action:'ankiAdd'}    ─► background ─► POST /anki/add         ─► AnkiConnect addNotes
```

Two reasons the screenshot round-trips back to the content script before cropping: only the
**background** worker may call `captureVisibleTab`, but only a **page context** has a real
`<canvas>` + `toDataURL` (the MV3 service worker has no DOM and no `FileReader`). So background
captures, content script crops.

---

## 3. `extension/manifest.json`

MV3 manifest. Key fields:

- `permissions`:
  - `activeTab`, `scripting` — baseline tab access.
  - `tabs` — required for `captureVisibleTab`.
  - `storage` — persists the **Enable snipping** toggle (`chrome.storage.local`).
  - `nativeMessaging` — allows `sendNativeMessage` to the launcher host.
- `host_permissions`:
  - `http://127.0.0.1:5000/*` — talk to the backend.
  - `<all_urls>` — needed so `captureVisibleTab` can screenshot any page.
- `content_scripts` — injects `content_script.js` into every page at `document_idle`.
- `background.service_worker` — `background.js`.
- `action.default_popup` — `popup.html`.

---

## 4. `extension/content_script.js`

Runs in the page. Wrapped in an IIFE so nothing leaks to page globals.

### Module state
| Variable | Purpose |
|---|---|
| `DIALOG_ID`, `OVERLAY_ID`, `SELECTION_ID` | Fixed element IDs so the script can find/replace its own injected nodes. |
| `lastResults` | The structured OCR array of the last snip (used to rebuild the popup / build Anki notes). |
| `cachedDecks` | Anki deck names, fetched lazily and reused (refreshed once per successful snip). |
| `snipping` | True while a selection drag is in progress. |
| `startX, startY` | Where the current selection drag began. |
| `enabled` | Mirror of the `chrome.storage.local` `enabled` flag; gates the Shift trigger. |

On load it reads `enabled` from storage and subscribes to `chrome.storage.onChanged` so toggling the
popup switch updates every open tab live.

### Event listeners
- **`keydown`** (capture):
  - `Shift` (not held-repeat, `enabled` true, not in a typing area, not already snipping) → `startSnip()`.
  - `Escape` → cancel an in-progress snip, otherwise close the popup.

### Snip overlay functions
- **`startSnip()`** — sets `snipping`, hides any existing popup, and injects two fixed-position divs:
  a full-viewport **overlay** (`OVERLAY_ID`, crosshair cursor, faint `rgba(0,0,0,0.12)` dim) and an
  initially hidden **selection** rectangle (`SELECTION_ID`, thin 1px white border + 1px dark outline,
  transparent fill). Attaches mouse handlers to the overlay.
- **`onSnipDown(e)`** — records `startX/startY`, shows the selection rect at zero size.
- **`onSnipMove(e)`** — resizes the selection rect to `normalizeRect(start, current)`.
- **`onSnipUp(e)`** — computes the final `rect`, captures `window.devicePixelRatio`, removes the
  overlay (`cleanupSnip`), ignores drags smaller than 4×4 px (accidental clicks), shows the popup
  with "⏳ Capturing…", then sends `{action:'snip'}` to the background. On reply it calls
  `cropAndSend`.
- **`cleanupSnip()` / `cancelSnip()`** — clear `snipping` and remove the overlay.
- **`normalizeRect(x1,y1,x2,y2)`** — returns `{x,y,w,h}` with positive width/height regardless of
  drag direction.

### Crop + send
- **`cropAndSend(screenshotDataUrl, rect, dpr)`** — loads the full-viewport screenshot into an
  `Image`, draws the sub-rectangle `rect×dpr` onto a `<canvas>` of that size, exports
  `toDataURL('image/png')`, and posts `{action:'ocrImage', src}` to the background. The `×dpr`
  conversion maps CSS pixels (selection coordinates) to device pixels (screenshot resolution).

### Result popup (Shadow DOM)
The popup is a host `<div id=DIALOG_ID>` with an attached **Shadow DOM**, so page CSS can't leak into
it (and vice-versa). The host carries only position/z-index inline; all visual styling lives in a
`<style>` block (`DIALOG_STYLES`) inside the shadow root. Structure: a draggable `.hdr`, a `.body`
(status line + context line + `.words`), and a `.footer` (deck `<select>`, **+ New deck** button,
inline new-deck form, **Add to Anki** button, `.anki-status`).

- **`showDialog(x, y)`** — builds the host + shadow tree, wires the footer, clamps, and makes it
  draggable. Renders `lastResults` if present, else shows "No text yet". Sizing is content-driven
  (`width:max-content`) but capped to `min(380px,90vw)` × `min(70vh,480px)`.
- **`setStatus(text)`** — shows a transient message (capturing / sending / error) and hides the word
  list + footer.
- **`renderResults(results)`** — stores `lastResults`; shows the full line as `.context`; renders one
  checkbox row per word entry (`label > input[checkbox] + span`, built with `textContent` so OCR text
  is never HTML-injected); reveals the footer and calls `loadDecks` when there are words. Error/empty
  payloads (`[{error}]`) fall back to `setStatus`.
- **`wireFooter` / `loadDecks` / `createDeck` / `addToAnki`** — the Anki controls (see §6.5).
- **`clampToViewport(host, left, top)`** — clamps using rendered `offsetWidth/Height` (8px margin);
  **`reclamp()`** re-clamps at the current position after content/size changes.
- **`makeDraggable(host, handle)`** — on header `mousedown`, tracks the pointer and repositions via
  `clampToViewport`; releases listeners on `mouseup`.
- **`hideDialog()`** — removes the host element. **`getShadow()`** — returns the live shadow root.
- **`isTypingArea(el)`** — true for `<input>`, `<textarea>`, or `contenteditable`; ignores Shift
  while typing.

### Anki footer (§6.5 of this file describes the contracts)
- **`wireFooter(shadow)`** — binds the **+ New deck** toggle (reveals/focuses the inline form),
  Create/Cancel, Enter/Escape on the input, and the **Add to Anki** click.
- **`loadDecks(shadow)`** — uses `cachedDecks` if set, else sends `{action:'getDecks'}`; populates the
  `<select>`. On failure (Anki not running) it disables the deck controls and shows the error.
- **`createDeck(shadow)`** — sends `{action:'createDeck', deck}`; on success appends to `cachedDecks`,
  re-selects it, and hides the form.
- **`addToAnki(shadow)`** — collects checked rows into `notes:[{word,reading,meaning}]` from
  `lastResults`, sends `{action:'ankiAdd', deck, notes}`, and reports `✓ Added N (M skipped)`.

### Incoming messages
A `chrome.runtime.onMessage` listener handles `{action:'setTranslation', text, results}` from the
background: it renders `results` via `renderResults` when present, else shows `text` via `setStatus`.

---

## 5. `extension/background.js`

The MV3 service worker (event-driven; may be torn down and restarted at any time).

- **`BACKEND_BASE`** — `http://127.0.0.1:5000`; the OCR + `/anki/*` URLs are derived from it (one
  place to change the port on the extension side).
- **`fetchJson(url, options, timeoutMs)`** — `fetch` wrapped in an `AbortController` timeout (30s for
  OCR, 10s for Anki) that parses JSON and throws a clean `Error` (using the body's `error`, the HTTP
  status, or `"Request timed out"`). Used by every backend call so a hung backend can't wedge the UI.
- **`updateBadge(enabled)`** — sets the toolbar badge to `"ON"` (green) or empty.
  - Wired to `chrome.runtime.onInstalled` (default state), `chrome.storage.onChanged` (live updates),
    and a top-level read (restores the badge after the worker wakes).
- **`formatOcrResults(data)`** — turns the backend's array into the fallback popup string. Each entry
  becomes `text（furigana）— translation`; `furigana` is omitted when equal to `text` or empty;
  `translation` is omitted when empty; `{error}` entries pass through verbatim. Empty/invalid →
  `"⚠️ No text detected"`.
- **`chrome.runtime.onMessage` router** (returns `true` to keep `sendResponse` async):
  - **`snip`** → `captureVisibleTab(windowId, {format:'png'})`; replies `{screenshot}` or `{error}`.
  - **`ocrImage`** → `POST` the cropped data URL as `{image_data}`; on success both **replies**
    `{ok, text, results}` and **broadcasts** `{action:'setTranslation', text, results}` (the raw array
    drives the per-word checkboxes); on failure broadcasts `"❌ <message>"`.
  - **`getDecks`** → `GET /anki/decks`; replies `{ok, decks}` / `{ok:false, error}`.
  - **`createDeck`** → `POST /anki/create-deck`; replies `{ok, deck}` / `{ok:false, error}`.
  - **`ankiAdd`** → `POST /anki/add`; replies `{ok, added, skipped}` / `{ok:false, error}`.

---

## 6. `extension/popup.html` + `popup.js`

The toolbar popup: a snipping toggle, a backend Start/Stop control, and a status line.

### `popup.html`
- A **toggle switch** (`#enabled-toggle`) bound to `chrome.storage.local.enabled`.
- A **Backend row** with a status hint (`#backend-status`) and a button (`#start-backend`).
- A details/output area (`#output`).
- CSS includes `.btn` (green) and `.btn.stop` (red) for the Start vs Stop states.

### `popup.js`
Constants: `NATIVE_HOST = 'com.alphaocr.launcher'`, `HEALTH_URL`, `SHUTDOWN_URL`. State: `mode`
(`'start'`|`'stop'`) decides what the button click does.

- **Toggle wiring** — initializes the switch from storage; writes back on `change`.
- **`setReady()`** — backend up: status ✅, button → red **"Stop"**, `mode='stop'`.
- **`setDown()`** — backend down: status ⚠️, button → green **"Start"**, `mode='start'`.
- **`checkHealth()`** — `GET /health`; returns `'ready'` (model loaded → `setReady`), `'loading'`
  (up but model not ready), or `'down'` (`setDown`).
- **`pollUntilReady(n)`** — re-checks every 1.5s up to `n` tries (~60s) after a start.
- **`pollUntilDown(n)`** — re-checks every 0.8s up to `n` tries (~16s) after a stop.
- **`startBackend()`** — `sendNativeMessage({action:'start'})`. Handles `lastError` (launcher not
  registered → instructions) and `{ok:false}` (launch failed), else polls until ready.
- **`stopBackend()`** — `POST /shutdown` (ignores the connection drop as the process exits), then
  polls until down.
- **Click handler** — dispatches to `startBackend`/`stopBackend` based on `mode`.
- On open it runs `checkHealth()` once to set the initial button/badge state.

---

## 7. `app.py` (backend)

Single-file Flask app. Loads heavy models once at import, then serves requests.

### Configuration (env-overridable)
`HOST` (default `127.0.0.1`), `PORT` (`5000`), `DEBUG`, `JISHO_TIMEOUT` (5s),
`MAX_IMAGE_BYTES` (10 MB → `app.config['MAX_CONTENT_LENGTH']`), `MAX_LOOKUPS` (20). Anki:
`ANKICONNECT_URL` (`http://127.0.0.1:8765`), `ANKI_TIMEOUT` (5s), `ANKI_NOTE_TYPE` (`AlphaOCR`).
`JISHO_API` is the Jisho words endpoint. Logging is configured to INFO (or DEBUG when `ALPHAOCR_DEBUG`).

### Startup
- **MangaOcr** is instantiated once into `mocr`; failure logs and `sys.exit(1)`.
- **fugashi `Tagger`** is loaded into `_tagger` if available; otherwise `_tagger=None` and a warning
  is logged (the app still runs in whole-text mode).
- `_HEAD_POS` = the UniDic part-of-speech tags that begin a lookup word (noun 名詞, pronoun 代名詞,
  verb 動詞, adjective 形容詞, adverb 副詞). `_LEMMA_POS` = tags that should resolve to their
  dictionary form (verbs/adjectives).
- Flask app created; **CORS** restricted to `^chrome-extension://.*$` so ordinary web pages can't
  read responses.

### Functions
- **`decode_image_from_data_url(data_url)`** — splits off the `data:` header, base64-decodes, and
  opens a `PIL.Image`. Returns `None` on any failure.
- **`lookup_jisho(keyword)`** — `GET` Jisho with `timeout=JISHO_TIMEOUT`; from the first match returns
  `{word, furigana(reading), translation(joined English definitions)}`, or `None` if no match /
  network error / unexpected shape. Wrapped in `functools.lru_cache(maxsize=512)` so repeated words
  (within and across snips) skip the network.
- **`tokenize_words(text)`** — the word splitter (see §8). Returns an ordered, de-duplicated list of
  lookup forms, or `[text]` when no tokenizer is present.
- **`anki_request(action, **params)`** — POSTs the AnkiConnect envelope
  (`{action, version:6, params}`) to `ANKICONNECT_URL` and returns its `result`; raises `AnkiError`
  on a network failure (Anki not running) or an AnkiConnect-reported error.
- **`ensure_note_type()`** — runs once per process (cached via `_note_type_ready`): if
  `ANKI_NOTE_TYPE` isn't in `modelNames`, creates a Front/Back note type via `createModel`. Anki's
  stock note types are localized (a non-English install has no model named "Basic"), so AlphaOCR
  ships its own; overriding `ALPHAOCR_ANKI_NOTE_TYPE` to an existing model skips creation.
- **`_build_anki_note(deck, word, reading, meaning)`** — maps a word to an AnkiConnect note:
  `modelName=ANKI_NOTE_TYPE`, `fields={Front: word, Back: "（reading）<br>meaning"}` (reading omitted
  when empty or equal to the word), `tags=["alphaocr"]`, `options.duplicateScope="deck"`.

### Routes
- **`GET /health`** → `{status:"ok", model_loaded: bool}`. Used by the popup.
- **`POST /shutdown`** → spawns a daemon thread that sleeps 0.3s then `os._exit(0)` (so the response
  flushes first), and returns `{status:"shutting down"}`. Backs the popup's Stop button.
- **`GET /anki/decks`** → `{decks: sorted(deckNames)}`, or `{error}` (502) if Anki is unreachable.
- **`POST /anki/create-deck`** → validates `{deck}` (400 if empty), calls `createDeck`, returns
  `{deck}` (or `{error}` 502). Idempotent — AnkiConnect no-ops if the deck exists.
- **`POST /anki/add`** → validates `{deck, notes}` (400 if missing/empty), calls
  `ensure_note_type()`, builds notes via `_build_anki_note`, calls `addNotes`, and returns
  `{added, skipped, ids}` (AnkiConnect returns `null` ids for duplicates → counted as `skipped`),
  or `{error}` (502).
- **`POST /ocr-and-translate`** — the main route:
  1. `get_json(silent=True)`; require `image_data` (else 400).
  2. `decode_image_from_data_url`; (else 400).
  3. If `DEBUG`, save `debug_cropped_image.png`.
  4. `recognized = mocr(image).strip()` (500 on OCR failure; `[{error}]` if empty).
  5. Build results: first entry is the **full recognized line** (no translation, for context); then
     one `{text,furigana,translation}` per `tokenize_words(...)[:MAX_LOOKUPS]` that Jisho resolves.
  6. If nothing resolved, mark the single entry `"(no dictionary match)"`.
  7. Return the JSON list.

---

## 8. Word segmentation (`tokenize_words`)

Japanese has no spaces, so the OCR'd line is split with fugashi (UniDic). The algorithm reconstructs
useful "lookup units":

1. Iterate tokens. For each, read `pos1` (coarse part of speech) and `surface`.
2. **Prefix (接頭辞)** → buffer it in `pending_prefix` to attach to the next head word.
3. **Head word** (`pos1 ∈ _HEAD_POS`) → start a new unit. Use the **lemma** (dictionary form) for
   verbs/adjectives (so 殺した → 殺す), the **surface** otherwise. Prepend any pending prefix. Remember
   this unit index as `last_head`.
4. **Suffix (接尾辞)** → append its surface onto `last_head` (so 加害 + 者 → 加害者).
5. **Anything else** (particles 助詞, auxiliaries 助動詞, punctuation 補助記号, …) → reset the prefix
   buffer and `last_head`, breaking the current compound.
6. De-duplicate while preserving order.

Example: `私を殺した加害者に相応しい` → `['私', '殺す', '加害者', '相応しい']`.

This is *short-unit* segmentation extended with prefix/suffix merging — good for single words and
noun+suffix compounds, but it does not join longer phrases that span particles.

---

## 9. Native messaging launcher (`native_host/`)

Lets the popup's **Start** button spawn the backend. Chrome launches a registered host program, hands
it one JSON message over stdio, reads one reply, then closes it.

### `launch_host.py`
- **`read_message()`** — reads Chrome's framing: a 4-byte little-endian length prefix, then that many
  UTF-8 bytes of JSON. Returns the parsed object (or `None` at EOF).
- **`send_message(obj)`** — writes the same framing back to stdout and flushes.
- **`backend_running()`** — quick `socket.create_connection(('127.0.0.1',5000), 0.5)` probe.
- **`start_backend()`** — resolves the repo root (parent of `native_host/`), picks
  `venv/Scripts/python.exe` if present else `sys.executable`, and `Popen`s `app.py` **detached**
  (`DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW`, stdin `DEVNULL`, stdout/stderr →
  `backend.log`). The detach flags are why the backend survives after this short-lived host exits.
- **`main()`** — reads one message and dispatches: `status` → `{ok, running}`; `start` → if already
  running `{ok, already_running}` else start and `{ok, started}` (or `{ok:false, error}`); unknown →
  `{ok:false, error}`.

### `alphaocr_launcher.bat`
The executable Chrome actually invokes (a `.bat`, since the manifest `path` must point at a runnable
file). It calls the venv's `python.exe` (resolved relative to its own location via `%~dp0`) on
`launch_host.py`, falling back to `python` on PATH.

### `com.alphaocr.launcher.json`
The native-host manifest: `name`, `type:"stdio"`, `path:"alphaocr_launcher.bat"` (relative to the
manifest's folder), and `allowed_origins` listing the exact `chrome-extension://<id>/` permitted to
connect. The registration script fills in the real extension ID.

### `register_native_host.ps1`
One-time, run by the user. Parameters `-ExtensionId` (prompted if omitted) and `-Browser`
(Chrome/Edge/Brave). It writes the host manifest **UTF-8 without BOM** (Chrome's parser rejects a
BOM), then creates the registry key
`HKCU:\Software\<browser>\NativeMessagingHosts\com.alphaocr.launcher` whose default value points at
the manifest path. Chrome reads that key to find the host.

---

## 10. Contracts (quick reference)

### Extension internal messages
| Message | From → To | Payload | Reply |
|---|---|---|---|
| `snip` | content → background | — | `{screenshot}` or `{error}` |
| `ocrImage` | content → background | `{src}` (cropped PNG data URL) | `{ok, text, results}` / `{ok:false, error}` |
| `setTranslation` | background → content | `{text, results}` (`results` = the backend array) | `{ok:true}` |
| `getDecks` | content → background | — | `{ok, decks}` / `{ok:false, error}` |
| `createDeck` | content → background | `{deck}` | `{ok, deck}` / `{ok:false, error}` |
| `ankiAdd` | content → background | `{deck, notes:[{word,reading,meaning}]}` | `{ok, added, skipped}` / `{ok:false, error}` |

### Backend HTTP API
| Method/Path | Request | Response |
|---|---|---|
| `GET /health` | — | `{status, model_loaded}` |
| `POST /shutdown` | — | `{status:"shutting down"}` (process exits ~0.3s later) |
| `POST /ocr-and-translate` | `{image_data: <data URL>}` | `[{text,furigana,translation}...]` or `[{error}]` |
| `GET /anki/decks` | — | `{decks:[...]}` or `{error}` (502 if Anki unreachable) |
| `POST /anki/create-deck` | `{deck}` | `{deck}` or `{error}` |
| `POST /anki/add` | `{deck, notes:[{word,reading,meaning}]}` | `{added, skipped, ids}` or `{error}` |

The three `/anki/*` routes proxy to the **AnkiConnect** add-on (`localhost:8765`, configurable via
`ALPHAOCR_ANKICONNECT_URL`) via the `anki_request(action, **params)` helper, which raises `AnkiError`
(→ a clean `{error}`) when Anki isn't running. Notes are created as `ALPHAOCR_ANKI_NOTE_TYPE`
(default `AlphaOCR`, auto-created via `ensure_note_type` if missing): Front = word,
Back = `（reading）<br>meaning`, tagged `alphaocr`, with `duplicateScope:"deck"` so re-adding a word
already in that deck is skipped.

### Native messaging
| Action | Request | Reply |
|---|---|---|
| `start` | `{action:"start"}` | `{ok, started}` / `{ok, already_running}` / `{ok:false, error}` |
| `status` | `{action:"status"}` | `{ok, running}` |

---

## 11. Security model

- Backend binds **localhost** only; not exposed to the network.
- **CORS** is restricted to `chrome-extension://` origins, so web pages can't read responses.
- Request body is capped (`MAX_CONTENT_LENGTH`) and Jisho calls have a timeout, limiting hang/DoS.
- `/shutdown` is reachable by any local client (a deliberate trade-off so the Stop button works
  regardless of how the backend was started); the same threat actor could already spam the OCR
  endpoint, and it's localhost-only.
- The native host only accepts connections from the single extension ID listed in `allowed_origins`.
- The `/anki/*` routes make **outbound** calls to the AnkiConnect add-on (`ANKICONNECT_URL`,
  `localhost:8765`), only while handling those requests and bounded by `ANKI_TIMEOUT`. AnkiConnect is
  a separate trusted local service the user installs; the backend never exposes it to the network.

---

## 12. Where to change common things

| Want to… | Edit |
|---|---|
| Change the trigger key | `keydown` handler in `content_script.js` (`e.key === 'Shift'`) |
| Change which word types are looked up | `_HEAD_POS` / `tokenize_words` in `app.py` |
| Show more than the first Jisho sense | `lookup_jisho` in `app.py` |
| Change the backend port | `ALPHAOCR_PORT` env var **and** `BACKEND_BASE` in `background.js` + URLs in `popup.js` |
| Adjust result formatting | `formatOcrResults` in `background.js` |
| Change the Anki note type / fields | `ALPHAOCR_ANKI_NOTE_TYPE` env var / `_build_anki_note` in `app.py` |
| Restyle the result popup / word rows | `DIALOG_STYLES` + `renderResults` in `content_script.js` |
