import sys
from flask import Flask, request, jsonify
from flask_cors import CORS

# Initialize the Flask application
app = Flask(__name__)

# --- IMPORTANT ---
# Enable CORS (Cross-Origin Resource Sharing) for your app.
# This allows your Chrome extension to send requests to this server.
CORS(app)

# Define your API endpoint for OCR and translation
@app.route('/ocr-and-translate', methods=['POST'])
def handle_ocr():
    """
    Receives a POST request with image data and cursor coordinates,
    processes it, and returns the analysis.
    """
    print("Received a new request...")
    
    # 1. Get the JSON data from the request
    try:
        data = request.json
        if not data:
            print("Error: No JSON payload received.")
            return jsonify({"error": "No JSON payload"}), 400
            
    except Exception as e:
        print(f"Error parsing JSON: {e}")
        return jsonify({"error": f"Invalid JSON format: {e}"}), 400

    # 2. Extract the data from the JSON
    # The 'dataUrl' from captureVisibleTab is in 'image_data'
    image_data_url = data.get('image_data') 
    x = data.get('x')
    y = data.get('y')

    # 3. Validate the received data
    if not image_data_url or x is None or y is None:
        print(f"Error: Missing data. Got x={x}, y={y}, image_data=...{image_data_url[-20:] if image_data_url else 'None'}")
        return jsonify({"error": "Missing 'image_data', 'x', or 'y'"}), 400

    print(f"Successfully received data: x={x}, y={y}, image_size={len(image_data_url)}")

    # --- STUBBED RESPONSE (Step 1) ---
    # For now, we are not doing any OCR.
    # We will just send back a "dummy" response to prove the
    # connection works. This response MUST match the format
    # your content_script.js expects.
    
    stub_response = {
        "text": "日本語 (Stub)",
        "furigana": "にほんご (Stub)",
        "translation": f"Success! Received click at (x={x}, y={y}). Backend is connected."
    }
    
    # 4. Send the JSON response back to the extension
    return jsonify(stub_response)

# Standard Python entry point
if __name__ == '__main__':
    # Using 0.0.0.0 makes it accessible on your local network
    # port=5000 matches the URL in your background.js
    # debug=True automatically reloads the server when you save changes
    print("Starting Flask server on http://localhost:5000")
    app.run(host='0.0.0.0', port=5000, debug=True)