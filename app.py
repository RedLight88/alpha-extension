"""AlphaOCR backend.

Receives a cropped image (data URL) from the browser extension, runs MangaOcr
on it, looks the recognized text up on Jisho, and returns the result as JSON.
"""

import os
import sys
import io
import time
import base64
import logging
import threading

from flask import Flask, request, jsonify
from flask_cors import CORS
from PIL import Image
import requests
from manga_ocr import MangaOcr

# --- Configuration (overridable via environment variables) ---
HOST = os.environ.get("ALPHAOCR_HOST", "127.0.0.1")  # localhost only by default
PORT = int(os.environ.get("ALPHAOCR_PORT", "5000"))
DEBUG = os.environ.get("ALPHAOCR_DEBUG", "").lower() in ("1", "true", "yes")
JISHO_TIMEOUT = float(os.environ.get("ALPHAOCR_JISHO_TIMEOUT", "5"))
MAX_IMAGE_BYTES = int(os.environ.get("ALPHAOCR_MAX_IMAGE_BYTES", str(10 * 1024 * 1024)))  # 10 MB

JISHO_API = "https://jisho.org/api/v1/search/words"

logging.basicConfig(
    level=logging.DEBUG if DEBUG else logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger("alphaocr")

# --- Load the OCR model once at startup ---
try:
    log.info("Loading MangaOcr model... (this may take a moment)")
    mocr = MangaOcr()
    log.info("MangaOcr model loaded successfully.")
except Exception as e:
    log.error("Failed to load MangaOcr: %s", e)
    log.error("Make sure dependencies are installed: pip install -r requirements.txt")
    sys.exit(1)

# --- Japanese tokenizer (optional) ---
# Used to split recognized text into individual words so each can be looked up.
# If fugashi/unidic isn't installed we fall back to a single whole-text lookup.
try:
    from fugashi import Tagger
    _tagger = Tagger()
    log.info("fugashi tokenizer loaded; per-word lookup enabled.")
except Exception as e:
    _tagger = None
    log.warning("fugashi not available (%s); falling back to whole-text lookup. "
                "Install it for per-word results: pip install fugashi unidic-lite", e)

MAX_LOOKUPS = int(os.environ.get("ALPHAOCR_MAX_LOOKUPS", "20"))
# Unidic part-of-speech tags that start a word worth looking up.
_HEAD_POS = {"名詞", "代名詞", "動詞", "形容詞", "副詞"}  # noun, pronoun, verb, adj, adverb
# Verbs/adjectives use their dictionary (lemma) form; everything else uses the surface.
_LEMMA_POS = {"動詞", "形容詞"}

# --- Flask app ---
app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_IMAGE_BYTES
# Only allow the browser extension to read responses; plain web pages are blocked.
CORS(app, resources={r"/*": {"origins": r"^chrome-extension://.*$"}})

log.info("Backend ready on http://%s:%d", HOST, PORT)


def decode_image_from_data_url(data_url):
    """Turn a 'data:image/png;base64,...' string into a PIL Image, or None."""
    try:
        _header, data = data_url.split(",", 1)
        image_bytes = base64.b64decode(data)
        return Image.open(io.BytesIO(image_bytes))
    except Exception as e:
        log.error("Error decoding image: %s", e)
        return None


def lookup_jisho(keyword):
    """Look a word/phrase up on Jisho.

    Returns {"furigana", "translation", "word"} on a hit, or None if there is no
    match or the request fails.
    """
    try:
        resp = requests.get(JISHO_API, params={"keyword": keyword}, timeout=JISHO_TIMEOUT)
        resp.raise_for_status()
        data = resp.json()
        matches = data.get("data") if isinstance(data, dict) else None
        if not matches:
            return None

        first = matches[0]
        japanese = first["japanese"][0]
        reading = japanese.get("reading", "")
        word = japanese.get("word", reading)
        definitions = first["senses"][0]["english_definitions"]
        return {
            "word": word,
            "furigana": reading,
            "translation": ", ".join(definitions),
        }
    except requests.RequestException as e:
        log.error("Jisho request failed: %s", e)
        return None
    except (KeyError, IndexError, ValueError) as e:
        log.error("Unexpected Jisho response shape: %s", e)
        return None


def tokenize_words(text):
    """Split recognized text into distinct words worth looking up.

    Content words start a unit; a preceding prefix (接頭辞) and following
    suffixes (接尾辞) are merged in so compounds like 加害者 stay whole. Verbs
    and adjectives use their dictionary form. Falls back to [text] when no
    tokenizer is available. Order is preserved; duplicates are removed.
    """
    if _tagger is None:
        return [text]

    units = []
    last_head = None      # index in `units` of the most recent head word
    pending_prefix = ""   # prefix waiting to attach to the next head word

    for tok in _tagger(text):
        pos1 = tok.feature.pos1
        surface = tok.surface

        if pos1 == "接頭辞":  # prefix → attach to the next head
            pending_prefix += surface
            continue

        if pos1 in _HEAD_POS:
            lemma = getattr(tok.feature, "lemma", None)
            base = lemma if (pos1 in _LEMMA_POS and lemma and lemma != "*") else surface
            units.append(pending_prefix + base)
            pending_prefix = ""
            last_head = len(units) - 1
            continue

        if pos1 == "接尾辞" and last_head is not None:  # suffix → merge onto head
            units[last_head] += surface
            continue

        # Particle / auxiliary / punctuation / etc. break the current compound.
        pending_prefix = ""
        last_head = None

    seen = set()
    words = []
    for u in units:
        if u and u not in seen:
            seen.add(u)
            words.append(u)
    return words or [text]


@app.route("/health", methods=["GET"])
def health():
    """Liveness/readiness probe used by the extension popup."""
    return jsonify({"status": "ok", "model_loaded": mocr is not None})


@app.route("/shutdown", methods=["POST"])
def shutdown():
    """Stop the backend (triggered by the popup's Stop button)."""
    log.info("Shutdown requested; exiting.")
    # Delay slightly so this response can flush before the process exits.
    threading.Thread(target=lambda: (time.sleep(0.3), os._exit(0)), daemon=True).start()
    return jsonify({"status": "shutting down"})


@app.route("/ocr-and-translate", methods=["POST"])
def handle_ocr():
    """OCR the posted image and attach a Jisho lookup of the recognized text.

    Response: a JSON list with a single result object so the extension's
    formatter can render it, e.g.
        [{"text": "日本語", "furigana": "にほんご", "translation": "Japanese"}]
    or a single error object: [{"error": "..."}].
    """
    log.info("Received a new analysis request...")

    data = request.get_json(silent=True)
    if not data or not data.get("image_data"):
        return jsonify([{"error": "Missing 'image_data'"}]), 400

    pil_image = decode_image_from_data_url(data["image_data"])
    if pil_image is None:
        return jsonify([{"error": "Failed to decode image"}]), 400

    if DEBUG:
        try:
            pil_image.save("debug_cropped_image.png")
            log.debug("Saved debug_cropped_image.png")
        except Exception as e:
            log.debug("Could not save debug image: %s", e)

    # MangaOcr returns the recognized text as a single string.
    try:
        recognized = mocr(pil_image).strip()
        log.info("MangaOcr recognized: %r", recognized)
    except Exception as e:
        log.error("MangaOcr failed: %s", e)
        return jsonify([{"error": f"MangaOcr failed: {e}"}]), 500

    if not recognized:
        return jsonify([{"error": "Couldn't read any text from the image."}])

    # First line: the full recognized text (no translation) for context.
    results = [{"text": recognized, "furigana": "", "translation": ""}]

    # Then a dictionary entry per distinct word in the text.
    for word in tokenize_words(recognized)[:MAX_LOOKUPS]:
        entry = lookup_jisho(word)
        if entry:
            results.append({
                "text": word,
                "furigana": entry["furigana"],
                "translation": entry["translation"],
            })

    # If nothing resolved, at least flag the full text as having no match.
    if len(results) == 1:
        results[0]["translation"] = "(no dictionary match)"

    return jsonify(results)


if __name__ == "__main__":
    log.info("Starting Flask server on http://%s:%d", HOST, PORT)
    app.run(host=HOST, port=PORT, debug=DEBUG)
