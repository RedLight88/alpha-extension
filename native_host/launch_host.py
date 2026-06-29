"""AlphaOCR native messaging host.

Chrome launches this via the registered host manifest when the extension calls
chrome.runtime.sendNativeMessage('com.alphaocr.launcher', ...). It reads one
message from stdin (Chrome's 4-byte-length + JSON framing), optionally starts
the Flask backend as a detached process, and writes one JSON response back.

It deliberately does NOT keep running: it spawns the backend detached so the
backend outlives this short-lived host process.
"""

import sys
import os
import json
import struct
import socket
import subprocess

HOST = "127.0.0.1"
PORT = 5000


def read_message():
    raw_len = sys.stdin.buffer.read(4)
    if len(raw_len) < 4:
        return None
    msg_len = struct.unpack("<I", raw_len)[0]
    payload = sys.stdin.buffer.read(msg_len).decode("utf-8")
    return json.loads(payload)


def send_message(obj):
    encoded = json.dumps(obj).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("<I", len(encoded)))
    sys.stdout.buffer.write(encoded)
    sys.stdout.buffer.flush()


def backend_running():
    try:
        with socket.create_connection((HOST, PORT), timeout=0.5):
            return True
    except OSError:
        return False


def start_backend():
    here = os.path.dirname(os.path.abspath(__file__))
    repo = os.path.dirname(here)
    app_py = os.path.join(repo, "app.py")
    venv_py = os.path.join(repo, "venv", "Scripts", "python.exe")
    python = venv_py if os.path.exists(venv_py) else sys.executable

    # Backend stdout/stderr must NOT go to our stdout (that's the native channel).
    log_file = open(os.path.join(repo, "backend.log"), "ab")

    # Detach so the backend survives after this host process exits.
    DETACHED_PROCESS = 0x00000008
    CREATE_NEW_PROCESS_GROUP = 0x00000200
    CREATE_NO_WINDOW = 0x08000000

    subprocess.Popen(
        [python, app_py],
        cwd=repo,
        stdin=subprocess.DEVNULL,
        stdout=log_file,
        stderr=log_file,
        close_fds=True,
        creationflags=DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW,
    )


def main():
    message = read_message()
    if message is None:
        return

    action = message.get("action")
    if action == "status":
        send_message({"ok": True, "running": backend_running()})
        return

    if action == "start":
        if backend_running():
            send_message({"ok": True, "already_running": True})
            return
        try:
            start_backend()
            send_message({"ok": True, "started": True})
        except Exception as e:
            send_message({"ok": False, "error": str(e)})
        return

    send_message({"ok": False, "error": f"unknown action: {action}"})


if __name__ == "__main__":
    main()
