"""Persistent ASR worker process for low-latency inference."""

import json
import logging
import sys

# Direct all Python logging to stderr so stdout is strictly clean JSON for IPC
logging.basicConfig(stream=sys.stderr, level=logging.INFO)

import torch
# Apple Silicon M-series optimization: 4 performance threads minimizes context switching
torch.set_num_threads(4)

from ml.inference.kriti_backend import KritiBackend

def run_server():
    sys.stderr.write("[VoiceKey ASR] Loading Kriti model...\n")
    sys.stderr.flush()
    try:
        backend = KritiBackend()
        sys.stderr.write("[VoiceKey ASR] Model loaded and ready.\n")
        sys.stderr.flush()
        print(json.dumps({"status": "ready"}), flush=True)
    except Exception as e:
        sys.stderr.write(f"[VoiceKey ASR] Failed to load model: {e}\n")
        sys.stderr.flush()
        print(json.dumps({"status": "error", "message": str(e)}), flush=True)
        return

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            cmd = req.get("command")
            if cmd == "ping":
                print(json.dumps({"status": "pong"}), flush=True)
            elif cmd == "transcribe":
                audio_path = req.get("path")
                if not audio_path:
                    print(json.dumps({"status": "error", "message": "Missing path"}), flush=True)
                    continue
                text = backend.transcribe(audio_path)
                print(json.dumps({"status": "ok", "text": text}), flush=True)
            elif cmd == "quit":
                break
            else:
                print(json.dumps({"status": "error", "message": f"Unknown command: {cmd}"}), flush=True)
        except Exception as err:
            print(json.dumps({"status": "error", "message": str(err)}), flush=True)

if __name__ == "__main__":
    run_server()
