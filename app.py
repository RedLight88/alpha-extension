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

# --- MangaOcr Configuration ---
try:
    print("Loading MangaOcr model... (This may take a moment)")
    mocr = MangaOcr()
    print("MangaOcr model loaded successfully.")
except Exception as e:
    print("--- MANGA-OCR NOT FOUND ERROR ---")
    print(f"Error: {e}")
    print("Please make sure you have run 'pip install manga-ocr'")
    sys.exit(1)
# --- End of Configuration ---

app = Flask(__name__)
CORS(app)

print("Backend ready.")
# --- End of Setup ---


def decode_image_from_base_64(data_url):
    try:
        _header, data = data_url.split(',', 1)
        image_bytes = base64.b64decode(data)
        image = Image.open(io.BytesIO(image_bytes))
        return image
    except Exception as e:
        print(f"Error decoding image: {e}")
        return None

def lookup_word_on_jisho(word):
    """
    Looks up a single word on Jisho and returns a formatted dict.
    Returns None if not found.
    """
    try:
        print(f"Looking up '{word}' on Jisho...")
        jisho_url = f"https://jisho.org/api/v1/search/words?keyword={word}"
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
        
        return {
            "text": text,
            "furigana": furigana,
            "translation": translation
        }
    except Exception as e:
        print(f"Error looking up '{word}': {e}")
        # Return a dict in the expected format, but with error info
        return {
            "text": word,
            "furigana": "---",
            "translation": "(Not found in dictionary)"
        }

@app.route('/ocr-and-translate', methods=['POST'])
def handle_ocr():
    """
    Receives a pre-cropped screenshot, runs MangaOcr,
    looks up EACH word on Jisho, and returns a list of results.
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
        # This returns a list of strings, e.g., ['日本語', 'を']
        word_list = mocr(pil_image)
        print(f"MangaOcr found: {word_list}")
    except Exception as e:
        print(f"MangaOcr failed: {e}")
        return jsonify({"error": f"MangaOcr failed: {e}"}), 500

    # --- NEW LOGIC: Look up each word ---
    if word_list:
        response_data = []
        for word in word_list:
            word_data = lookup_word_on_jisho(word)
            if word_data:
                response_data.append(word_data)
        
        if response_data:
            return jsonify(response_data) # Send the list of results
        else:
            return jsonify({"error": "MangaOcr found text, but Jisho lookup failed for all."}), 400
    else:
        return jsonify({"error": "MangaOcr couldn't read the text."}), 400

# Standard Python entry point
if __name__ == '__main__':
    print("Starting Flask server on http://localhost:5000")
    app.run(host='0.0.0.0', port=5000, debug=False)

