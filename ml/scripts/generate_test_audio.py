"""Generates a sample 16kHz mono WAV file for testing."""

import math
import struct
import wave
from pathlib import Path

def generate_tone(path: Path, duration_sec: float = 1.0, freq: float = 440.0):
    sample_rate = 16000
    total_samples = int(sample_rate * duration_sec)
    with wave.open(str(path), "w") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        for i in range(total_samples):
            value = int(32767.0 * 0.5 * math.sin(2.0 * math.pi * freq * i / sample_rate))
            data = struct.pack("<h", value)
            wav_file.writeframesraw(data)

if __name__ == "__main__":
    out_dir = Path("tests/fixtures")
    out_dir.mkdir(parents=True, exist_ok=True)
    out_file = out_dir / "sample_16k.wav"
    generate_tone(out_file)
    print(f"Generated test audio at {out_file}")
