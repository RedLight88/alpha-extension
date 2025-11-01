import sys
import os
from flask import Flask, request, jsonify
from flask_cors import CORS
import base64
import io
import numpy
from PIL import Image
import requests
import pytesseract
from pytesseract import Output
import math 

# --- Tesseract Configuration ---
try:
    pytesseract.pytesseract.tesseract_cmd = r'C:\Program Files\Tesseract-OCR\tesseract.exe'
    version = pytesseract.get_tesseract_version()
    print(f"Tesseract {version} found and configured.")
except Exception as e:
    print("--- TESSERACT NOT FOUND ERROR ---")
    print(f"Error: {e}")
    sys.exit(1)
# --- End of Configuration ---

app = Flask(__name__)
CORS(app)

print("Backend ready.")
# --- End of Setup ---


def decode_image_from_base64(data_url):
    try:
        _header, data = data_url.split(',', 1)
        image_bytes = base64.b64decode(data)
        image = Image.open(io.BytesIO(image_bytes))
        return image
    except Exception as e:
        print(f"Error decoding image: {e}")
        return None

def find_word_closest_to_center(ocr_results, center_x, center_y):
    """
    Iterates through Tesseract's results to find the text
    CLOSEST to the center of the cropped image.
    """
    print(f"Cropped image center: ({center_x}, {center_y})")
    
    target_text = None
    min_distance = float('inf') 
    
    num_items = len(ocr_results['text'])
    
    for i in range(num_items):
        text = ocr_results['text'][i].strip()
        
        if not text:
            continue
            
        x_box = ocr_results['left'][i]
        y_box = ocr_results['top'][i]
        w = ocr_results['width'][i]
        h = ocr_results['height'][i]
        
        word_center_x = x_box + (w / 2)
        word_center_y = y_box + (h / 2)
        
        distance = math.sqrt((word_center_x - center_x)**2 + (word_center_y - center_y)**2)
        
        if distance < min_distance:
            min_distance = distance
            target_text = text
            
    if target_text:
        print(f"Found closest text: '{target_text}' (Distance: {min_distance:.2f}px)")
        
    return target_text

@app.route('/ocr-and-translate', methods=['POST'])
def handle_ocr():
    print("Received a new analysis request...")
    
    # 1. Get and validate JSON data
    try:
        data = request.json
        image_data_url = data.get('image_data')
        orientation = data.get('orientation', 'horizontal')

        if not image_data_url:
            return jsonify({"error": "Missing 'image_data'"}), 400
    except Exception as e:
        return jsonify({"error": f"Invalid JSON format: {e}"}), 400

    # 2. Decode the image
    pil_image = decode_image_from_base64(image_data_url)
    if pil_image is None:
        return jsonify({"error": "Failed to decode image"}), 400
        
    width, height = pil_image.size
    target_x = width / 2
    target_y = height / 2

    # 3. --- DYNAMIC TESSERACT CONFIG ---
    lang_config = ''
    psm_config = ''
    if orientation == 'vertical':
        print("Running Tesseract in VERTICAL mode.")
        lang_config = 'jpn_vert+jpn+eng'
        psm_config = '--psm 5'
    else:
        print("Running Tesseract in HORIZONTAL mode.")
        lang_config = 'jpn+eng'
        psm_config = '--psm 6'
    # --- END DYNAMIC CONFIG ---

    # 4. Run Tesseract OCR
    try:
        print(f"Running Tesseract data-dict (lang={lang_config}, psm={psm_config})...")
        results = pytesseract.image_to_data(
            pil_image, 
            lang=lang_config, 
            config=psm_config, 
            output_type=Output.DICT
        )
        print(f"Tesseract found {len(results['text'])} text block(s).")
    except Exception as e:
        print(f"Tesseract OCR failed: {e}")
        if 'Failed loading language' in str(e):
             print("--- ERROR: 'jpn_vert' language pack not found. ---")
             print("--- Please re-run the Tesseract installer and add it. ---")
        return jsonify({"error": f"Tesseract OCR failed: {e}"}), 500

    # 5. Find the word at the center
    target_text = find_word_closest_to_center(results, target_x, target_y)
    
    # 6. Get Furigana and Translation from Jisho
    if target_text:
        try:
            print(f"Looking up '{target_text}' on Jisho...")
            jisho_url = f"https://jisho.org/api/v1/search/words?keyword={target_text}"
            response = requests.get(jisho_url)
            
            if response.status_code != 200:
                raise Exception(f"Jisho API returned status code {response.status_code}")

            json_data = response.json()

            if not json_data or 'data' not in json_data or not json_data['data']:
                raise Exception("Word not found in dictionary.")

            first_match = json_data['data'][0]
            furigana = first_match['japanese'][0]['reading']
            # --- THIS IS THE FIXED LINE ---
            text = first_match['japanese'][0].get('word', furigana)
            # --- END FIX ---
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
        response_data = {
            "text": "---",
            "furigana": "No text found",
            "translation": "Tesseract couldn't read the text at your cursor."
        }
        
    return jsonify(response_data)

# Standard Python entry point
if __name__ == '__main__':
    print("Starting Flask server on http://localhost:5000")
    app.run(host='0.0.0.0', port=5000, debug=False)
