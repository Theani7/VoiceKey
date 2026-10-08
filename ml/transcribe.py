"""CLI entrypoint for ml.transcribe."""

import argparse
import sys
from ml.inference.kriti_backend import KritiBackend

def main() -> int:
    parser = argparse.ArgumentParser(description="VoiceKey CLI Transcriber")
    parser.add_argument("audio", nargs="+", help="Path to 16 kHz audio file(s)")
    parser.add_argument("--model", default="harrrshall/kriti", help="Model repo or path")
    args = parser.parse_args()

    backend = KritiBackend(repo_id=args.model)
    transcriptions = backend.transcribe(args.audio)
    if isinstance(transcriptions, str):
        print(transcriptions)
    else:
        for t in transcriptions:
            print(t)
    return 0

if __name__ == "__main__":
    sys.exit(main())
