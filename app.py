import sys
import os
from flask import Flask, request, jsonify
from flask_cors import CORS
import base64
import io
import numpy
from PIL import Image
import requests
from manga_ocr import MangaOcr
import re # <-- NEW IMPORT for regex

# --- MangaOcr Configuration ---
try:
    print("Loading MangaOcr model... (This may take a moment)")
    mocr = MangaOcr()
    print("MangaOcr model loaded successfully.")
except Exception as e:
    print("--- MANGA-OCR NOT FOUND ERROR ---\nError: {e}\nCheck pip install manga-ocr.")
    sys.exit(1)
# --- End of Configuration ---

app = Flask(__name__)
CORS(app)

print("Backend ready.")
# --- End of Setup ---

# --- NEW HELPER FUNCTION ---
def contains_kanji(text):
    """
    Checks if a string contains any CJK (Kanji) characters.
    """
    # This regex matches characters in the CJK Unified Ideographs block
    return re.search(r'[\u4e00-\u9fff]', text)
# --- END NEW FUNCTION ---


def decode_image_from_base_64(data_url):
    """
    Takes a 'data:image/png;base64,...' string and returns a PIL Image
    """
    try:
        _header, data = data_url.split(',', 1)
        image_bytes = base64.b64decode(data)
        image = Image.open(io.BytesIO(image_bytes))
        return image
    except Exception as e:
        print(f"Error decoding image: {e}")
        return None

@app.route('/ocr-and-translate', methods=['POST'])
def handle_ocr():
    """
    Receives a *pre-cropped* screenshot, runs MangaOcr,
    joins all found text, and looks it up on Jisho.
    """
    print("Received a new analysis request...")
    
    try:
        data = request.json
        image_data_url = data.get('image_data')
        if not image_data_url:
            return jsonify({"error": "Missing 'image_data'"}), 400
    except Exception as e:
        return jsonify({"error": f"Invalid JSON format: {e}"}), 400

    pil_image = decode_image_from_base_64(image_data_url)
    if pil_image is None:
        return jsonify({"error": "Failed to decode image"}), 400
        
    try:
        pil_image.save("debug_cropped_image.png")
        print("Debug image 'debug_cropped_image.png' saved successfully.")
    except Exception as e:
        print(f"Error saving debug image: {e}")

    try:
        print(f"Running MangaOcr on image...")
        ocr_results = mocr(pil_image)
        print(f"MangaOcr found: {ocr_results}")
    except Exception as e:
        print(f"MangaOcr failed: {e}")
        return jsonify({"error": f"MangaOcr failed: {e}"}), 500

    # --- NEW OPTIMIZED LOGIC ---
    
    # This will be our list of results to send back
    response_data = []

    if not ocr_results:
        # MangaOcr found nothing
        response_data = [{"error": "MangaOcr couldn't read the text."}]
        return jsonify(response_data)

    # Loop through each word found by MangaOcr
    for word in ocr_results:
        target_text = word.strip()
        if not target_text:
            continue

        # Check if the word contains Kanji
        if contains_kanji(target_text):
            # --- Word contains Kanji, look it up on Jisho ---
            try:
                print(f"Looking up KANJI word: '{target_text}'...")
                jisho_url = f"https://jisho.org/api/v1/search/words?keyword={target_text}"
                response = requests.get(jisho_url)
                
                if response.status_code != 200:
                    raise Exception(f"Jisho API returned status {response.status_code}")

                json_data = response.json()
                if not json_data or 'data' not in json_data or not json_data['data']:
                    raise Exception("Word not found in dictionary.")

                first_match = json_data['data'][0]
                furigana = first_match['japanese'][0]['reading']
                text = first_match['japanese'][0].get('word', furigana)
                definitions = first_match['senses'][0]['english_definitions']
                translation = ", ".join(definitions)
                
                response_data.append({
                    "text": text,
                    "furigana": furigana,
                    "translation": translation
                })
            except Exception as e:
                print(f"Error looking up Jisho: {e}")
                response_data.append({
                    "text": target_text,
                    "furigana": "---",
                    "translation": "(Could not find in dictionary)"
                })
        else:
            # --- Word is ONLY Kana, don't look it up ---
            print(f"Skipping Jisho for KANA word: '{target_text}'")
            response_data.append({
                "text": target_text,
                "furigana": "", # No furigana needed for kana
                "translation": "(Kana)"
            })
            
    return jsonify(response_data)
    # --- END NEW OPTIMIZED LOGIC ---

# Standard Python entry point
if __name__ == '__main__':
    print("Starting Flask server on http://localhost:5000")
    app.run(host='0.0.0.0', port=5000, debug=False)

