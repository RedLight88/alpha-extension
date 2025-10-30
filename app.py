import sys
from flask import Flask, request, jsonify
from flask_cors import CORS
import base64
import io
import numpy
from PIL import Image
import requests
import pytesseract
from pytesseract import Output

# --- Tesseract Configuration ---
# 1. This tells pytesseract where to find the .exe you just installed.
# 2. Check this path! If you installed Tesseract somewhere else, update this string.
# 3. The 'r' at the beginning (r'...') is important. It means "raw string".
try:
    pytesseract.pytesseract.tesseract_cmd = r'C:\Program Files\Tesseract-OCR\tesseract.exe'
    # Test if it's working
    version = pytesseract.get_tesseract_version()
    print(f"Tesseract {version} found and configured.")
except Exception as e:
    print("--- TESSERACT NOT FOUND ERROR ---")
    print(f"Error: {e}")
    print(f"Please check that 'tesseract_cmd' is set to the correct path.")
    print(r"Default is: C:\Program Files\Tesseract-OCR\tesseract.exe")
    sys.exit(1)
# --- End of Configuration ---

app = Flask(__name__)
CORS(app)

print("Backend ready.")
# --- End of Setup ---


def decode_image_from_base64(data_url):
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

def find_word_at_cursor(ocr_results, x_logical, y_logical, pixelRatio):
    """
    Iterates through Tesseract's OCR results to find the text at the cursor.
    Tesseract's data is different from easyocr's.
    """
    x_physical = x_logical * pixelRatio
    y_physical = y_logical * pixelRatio
    
    print(f"Logical coords: ({x_logical}, {y_logical}). PixelRatio: {pixelRatio}. Physical coords: ({x_physical}, {y_physical})")
    
    target_text = None
    # Tesseract's 'results' is a dictionary. We loop through each detected word.
    num_items = len(ocr_results['text'])
    
    for i in range(num_items):
        # Get the bounding box of the word
        x_box = ocr_results['left'][i]
        y_box = ocr_results['top'][i]
        w = ocr_results['width'][i]
        h = ocr_results['height'][i]
        
        # Get the text (and clean it)
        text = ocr_results['text'][i].strip()
        
        # Skip empty text (like whitespace)
        if not text:
            continue
            
        # Check if the PHYSICAL cursor (x_physical, y_physical) is inside this box
        if (x_box <= x_physical <= (x_box + w)) and (y_box <= y_physical <= (y_box + h)):
            target_text = text
            print(f"Found text: '{target_text}' at cursor.")
            break # Found our word
            
    return target_text

@app.route('/ocr-and-translate', methods=['POST'])
def handle_ocr():
    """
    Receives screenshot and cursor, runs Tesseract OCR, finds the word,
    and returns the word, furigana, and translation from Jisho.
    """
    print("Received a new analysis request...")
    
    # 1. Get and validate JSON data
    try:
        data = request.json
        image_data_url = data.get('image_data')
        x = data.get('x')
        y = data.get('y')
        pixelRatio = data.get('pixelRatio', 1.0) 

        if not image_data_url or x is None or y is None:
            return jsonify({"error": "Missing 'image_data', 'x', or 'y'"}), 400
    except Exception as e:
        return jsonify({"error": f"Invalid JSON format: {e}"}), 400

    # 2. Decode the image
    pil_image = decode_image_from_base64(image_data_url)
    if pil_image is None:
        return jsonify({"error": "Failed to decode image"}), 400

    # 3. --- Run Tesseract OCR ---
    try:
        print("Running Tesseract OCR on the image...")
        # Use 'jpn+eng' to detect both Japanese and English
        # output_type=Output.DICT makes it return a useful dictionary
        results = pytesseract.image_to_data(pil_image, lang='jpn+eng', output_type=Output.DICT)
        print(f"Tesseract found {len(results['text'])} text block(s).")
    except Exception as e:
        return jsonify({"error": f"Tesseract OCR failed: {e}"}), 500

    # 4. Find the word at the cursor
    target_text = find_word_at_cursor(results, x, y, pixelRatio)
    
    # 5. Get Furigana and Translation from Jisho (This part is unchanged)
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
        # Cursor wasn't on any text
        response_data = {
            "text": "---",
            "furigana": "No text found",
            "translation": "Cursor was not over any detectable text."
        }
        
    return jsonify(response_data)


# Standard Python entry point
if __name__ == '__main__':
    print("Starting Flask server on http://localhost:5000")
    app.run(host='0.0.0.0', port=5000, debug=False)

