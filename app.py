import sys
import os
from flask import Flask, request, jsonify
from flask_cors import CORS
import base64
import io
import numpy
from PIL import Image
import requests
# We no longer need pytesseract
from manga_ocr import MangaOcr # <-- NEW IMPORT

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

# --- We no longer need find_word_at_center ---

@app.route('/ocr-and-translate', methods=['POST'])
def handle_ocr():
    """
    Receives a *pre-cropped* screenshot, runs MangaOcr,
    joins all found text, and looks it up on Jisho.
    """
    print("Received a new analysis request...")
    
    # 1. Get and validate JSON data
    try:
        data = request.json
        image_data_url = data.get('image_data')

        if not image_data_url:
            return jsonify({"error": "Missing 'image_data'"}), 400
    except Exception as e:
        return jsonify({"error": f"Invalid JSON format: {e}"}), 400

    # 2. Decode the image to a PIL Image
    pil_image = decode_image_from_base_64(image_data_url)
    if pil_image is None:
        return jsonify({"error": "Failed to decode image"}), 400
        
    # --- NEW DEBUGGING CODE ---
    try:
        # Save the received cropped image to disk for inspection
        pil_image.save("debug_cropped_image.png")
        print("Debug image 'debug_cropped_image.png' saved successfully.")
    except Exception as e:
        print(f"Error saving debug image: {e}")
    # --- END NEW DEBUGGING CODE ---

    # 3. --- Run MangaOcr ---
    try:
        print(f"Running MangaOcr on image...")
        
        # This returns a list of strings, e.g., ['日本語', 'を']
        results = mocr(pil_image)
        
        # Join all found text into a single string
        target_text = "".join(results).strip()
        
        print(f"MangaOcr found: '{target_text}'")
    except Exception as e:
        print(f"MangaOcr failed: {e}")
        return jsonify({"error": f"MangaOcr failed: {e}"}), 500

    # 4. Get Furigana and Translation from Jisho
    if target_text:
        try:
            print(f"Looking up '{target_text}' on Jisho...")
            # --- THIS IS THE FIX ---
            jisho_url = f"https://jisho.org/api/v1/search/words?keyword={target_text}"
            # --- END FIX ---
            response = requests.get(jisho_url)
            
            if response.status_code != 200:
                raise Exception(f"Jisho API returned status code {response.status_code}")

            json_data = response.json()

            if not json_data or 'data' not in json_data or not json_data['data']:
                raise Exception("Word not found in dictionary.")

            first_match = json_data['data'][0]
            furigana = first_match['japanese'][0]['reading']
            text = first_match['japanese'][0].get('word', furigana)
            definitions = first_match['senses'][0]['english_definitions']
            translation = ", ".join(definitions)
            
            print(f"Jisho result: {text} [{furigana}] - {translation}")

            response_data = {
                "text": text,
                "furigana": furigana,
                "translation": translation
            }
        except Exception as e:
            print(f"Error looking up on Jisho (or parsing): {e}")
            response_data = {
                "text": target_text,
                "furigana": "---",
                "translation": "(Could not find in dictionary)"
            }
    else:
        # MangaOcr found nothing in the cropped image
        response_data = {
            "text": "---",
            "furigana": "No text found",
            "translation": "MangaOcr couldn't read the text."
        }
        
    return jsonify(response_data)


# Standard Python entry point
if __name__ == '__main__':
    print("Starting Flask server on http://localhost:5000")
    app.run(host='0.0.0.0', port=5000, debug=False)

