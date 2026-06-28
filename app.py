import sys              # For exiting the script (sys.exit)
from flask import Flask, request, jsonify  # The core Flask web server tools
from flask_cors import CORS                # To allow requests from our extension
import base64           # To decode the base64 image string
import io               # To read the image data "in memory"
from PIL import Image    # To open and save the image
import requests         # To make API calls to Jisho.org
from manga_ocr import MangaOcr  # The OCR engine
import re               # For our Kanji-detecting Regex

# --- 1. Model Configuration ---
# This code runs ONCE when the server starts.
try:
    print("Loading MangaOcr model... (This may take a moment)")
    # Initialize the MangaOcr model. This loads the
    # machine learning model into memory (RAM/VRAM).
    mocr = MangaOcr()
    print("MangaOcr model loaded successfully.")
except Exception as e:
    # Handle failure
    print("--- MANGA-OCR NOT FOUND ERROR ---")
    print(f"Error: {e}")
    print("Please make sure you have run 'pip install manga-ocr'")
    sys.exit(1) # Stop the server
# --- End of Configuration ---

# --- 2. Flask App Setup ---
app = Flask(__name__)  # Create the Flask app instance
# Enable Cross-Origin Resource Sharing (CORS).
# This is required to allow our extension (running on a "chrome-extension://"
# origin) to send requests to our server (running on "http://localhost:5000").
CORS(app)

print("Backend ready.")
# --- End of Setup ---

# --- 3. Helper Function: contains_kanji ---
def contains_kanji(text):
    """
    Checks if a string contains any CJK (Kanji) characters.
    Input: 'text' (string) - e.g., "日本語" or "です"
    Output: (boolean) - True if Kanji is found, else False.
    """
    # This regex searches for any character in the
    # Unicode range U+4E00 to U+9FFF (CJK Unified Ideographs).
    if re.search(r'[\u4e00-\u9fff]', text):
        return True
    else:
        return False

# --- 4. Helper Function: decode_image_from_base_64 ---
def decode_image_from_base_64(data_url):
    """
    Takes a 'data:image/png;base64,...' string and returns a PIL Image object.
    Input: 'data_url' (string)
    Output: 'Image' (PIL.Image object) or None if it fails.
    """
    try:
        # Split the string at the comma to separate the
        # header ("data:image/png;base64") from the data.
        _header, data = data_url.split(',', 1)
        # Decode the base64 data into raw bytes
        image_bytes = base64.b64decode(data)
        # Read the raw bytes "in-memory" using io.BytesIO
        # and open it as a PIL (Pillow) Image.
        image = Image.open(io.BytesIO(image_bytes))
        return image
    except Exception as e:
        print(f"Error decoding image: {e}")
        return None

# --- 5. The Main API Endpoint ---
# This decorator tells Flask: "When you receive a POST request
# to the '/ocr-and-translate' URL, run this function."
@app.route('/ocr-and-translate', methods=['POST'])
def handle_ocr():
    """
    This is the main function of our server.
    Input: (Implicit) The Flask 'request' object containing the JSON payload.
    Output: A JSON list of results.
    """
    print("Received a new analysis request...")
    
    # --- Step 5a: Parse the Request ---
    try:
        data = request.json  # Get the JSON data from the request body
        image_data_url = data.get('image_data') # Get the 'image_data' key
        if not image_data_url:
            # If no image was sent, return a 400 Bad Request error.
            return jsonify({"error": "Missing 'image_data'"}), 400
    except Exception as e:
        return jsonify({"error": f"Invalid JSON format: {e}"}), 400

    # --- Step 5b: Decode the Image ---
    pil_image = decode_image_from_base_64(image_data_url)
    if pil_image is None:
        return jsonify({"error": "Failed to decode image"}), 400
        
    # --- Step 5c: Save Debug Image ---
    # This saves the cropped image to disk so you can see what MangaOcr sees.
    try:
        pil_image.save("debug_cropped_image.png")
        print("Debug image 'debug_cropped_image.png' saved successfully.")
    except Exception as e:
        print(f"Error saving debug image: {e}")

    # --- Step 5d: Run the OCR ---
    try:
        print(f"Running MangaOcr on image...")
        # This is the "magic" call. We pass the PIL Image to the
        # loaded model ('mocr').
        # It returns a list of strings, e.g., ['百', '葉', '箱']
        ocr_results = mocr(pil_image)
        print(f"MangaOcr found: {ocr_results}")
    except Exception as e:
        print(f"MangaOcr failed: {e}")
        return jsonify([{"error": f"MangaOcr failed: {e}"}])

    # --- Step 5e: Filter, Lookup, and Build Response ---
    
    # This is the list we will send back to the user.
    response_data = []

    if not ocr_results:
        # If MangaOcr returned an empty list, tell the user.
        response_data = [{"error": "MangaOcr couldn't read the text."}]
        return jsonify(response_data)

    # Loop through each word found by the OCR
    for word in ocr_results:
        target_text = word.strip()
        if not target_text:
            continue # Skip empty strings

        # --- The Kanji Filter ---
        if contains_kanji(target_text):
            # --- Word contains Kanji: Look it up on Jisho ---
            try:
                print(f"Looking up KANJI word: '{target_text}'...")
                jisho_url = f"https://jisho.org/api/v1/search/words?keyword={target_text}"
                response = requests.get(jisho_url) # Make the API call
                
                if response.status_code != 200:
                    raise Exception(f"Jisho API returned status {response.status_code}")

                json_data = response.json()
                if not json_data or 'data' not in json_data or not json_data['data']:
                    raise Exception("Word not found in dictionary.")

                # --- Parse the Jisho Response ---
                first_match = json_data['data'][0]
                furigana = first_match['japanese'][0]['reading']
                text = first_match['japanese'][0].get('word', furigana)
                definitions = first_match['senses'][0]['english_definitions']
                translation = ", ".join(definitions) # Join multiple definitions
                
                # Add the successful result to our list
                response_data.append({
                    "text": text,
                    "furigana": furigana,
                    "translation": translation
                })
            except Exception as e:
                # Handle Jisho failures (word not found, API down, etc.)
                print(f"Error looking up Jisho: {e}")
                response_data.append({
                    "text": target_text,
                    "furigana": "---",
                    "translation": "(Could not find in dictionary)"
                })
        else:
            # --- Word is ONLY Kana: Skip it ---
            # This 'pass' is your filter. We do nothing,
            # so Kana-only words are not added to the list.
            print(f"Skipping Jisho for KANA word: '{target_text}'")
            pass
            
    # Send the final list back to the browser
    return jsonify(response_data)

# --- 6. The Entry Point ---
# This is the standard Python "main" block.
# It only runs if you execute 'python app.py' directly.
if __name__ == '__main__':
    print("Starting Flask server on http://localhost:5000")
    # Start the Flask server.
    # host='0.0.0.0' makes it accessible from your local network.
    # debug=False is for production. Set to True if you're still editing.
    app.run(host='0.0.0.0', port=5000, debug=False)

