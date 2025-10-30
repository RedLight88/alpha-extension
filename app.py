import sys
from flask import Flask, request, jsonify
from flask_cors import CORS
import easyocr
import base64
import io
import numpy
from PIL import Image
import requests  

# --- Model Setup ---
app = Flask(__name__)
CORS(app)

print("Loading EasyOCR model...")
try:
    reader = easyocr.Reader(['ja', 'en'])
    print("EasyOCR model loaded successfully.")
except Exception as e:
    print(f"CRITICAL: Failed to load EasyOCR model. Error: {e}")
    sys.exit(1)

# (Jisho initialization is no longer needed)
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
    Iterates through OCR results to find the text at the cursor
    by scaling the logical coordinates to physical screenshot coordinates.
    """
    x_physical = x_logical * pixelRatio
    y_physical = y_logical * pixelRatio
    
    print(f"Logical coords: ({x_logical}, {y_logical}). PixelRatio: {pixelRatio}. Physical coords: ({x_physical}, {y_physical})")
    
    target_text = None
    for (bbox, text, prob) in ocr_results:
        (x_min, y_min) = bbox[0]
        (x_max, y_max) = bbox[2]
        
        if (x_min <= x_physical <= x_max) and (y_min <= y_physical <= y_max):
            target_text = text
            print(f"Found text: '{target_text}' at cursor.")
            break # Found our word
            
    return target_text

@app.route('/ocr-and-translate', methods=['POST'])
def handle_ocr():
    """
    Receives screenshot and cursor, runs OCR, finds the word,
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

    # 3. Run OCR
    try:
        image_np = numpy.array(pil_image)
        print("Running OCR on the image...")
        results = reader.readtext(image_np)
        print(f"OCR found {len(results)} text block(s).")
    except Exception as e:
        return jsonify({"error": f"OCR failed: {e}"}), 500

    # 4. Find the word at the cursor
    target_text = find_word_at_cursor(results, x, y, pixelRatio)
    
    # 5. --- NEW: Get Furigana and Translation using requests ---
    if target_text:
        try:
            print(f"Looking up '{target_text}' on Jisho...")
            
            # Define the Jisho API endpoint
            jisho_url = f"https://jisho.org/api/v1/search/words?keyword={target_text}"
            
            # Make the web request
            response = requests.get(jisho_url)
            
            # Check if the request was successful
            if response.status_code != 200:
                raise Exception(f"Jisho API returned status code {response.status_code}")

            json_data = response.json()

            if not json_data or 'data' not in json_data or not json_data['data']:
                raise Exception("Word not found in dictionary.")

            # Get the first match
            first_match = json_data['data'][0]
            
            # Get the reading (furigana)
            furigana = first_match['japanese'][0]['reading']
            
            # Get the word (kanji)
            text = first_match['japanese'][0].get('word', furigana)
            
            # Get the English definitions
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

