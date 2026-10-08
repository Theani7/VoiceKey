import time
import os
import sys
from pathlib import Path

# Add project root to sys.path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

import psutil
from ml.scripts.generate_test_audio import generate_tone

def benchmark_latency(audio_path: Path):
    process = psutil.Process(os.getpid())
    mem_before = process.memory_info().rss / (1024 * 1024)

    print(f"Benchmarking on Apple Silicon ({os.uname().machine})...")
    print(f"Process RAM before model load: {mem_before:.2f} MB")

    start_load = time.perf_counter()
    from ml.inference.kriti_backend import KritiBackend
    backend = KritiBackend()
    load_time = time.perf_counter() - start_load
    mem_after = process.memory_info().rss / (1024 * 1024)
    print(f"Model Load Time: {load_time:.2f} s")
    print(f"Process RAM after model load: {mem_after:.2f} MB (Delta: +{mem_after - mem_before:.2f} MB)")

    # Measure transcription latency
    start_infer = time.perf_counter()
    transcription = backend.transcribe(str(audio_path))
    infer_time = time.perf_counter() - start_infer

    print(f"Transcription result: '{transcription}'")
    print(f"Inference Latency: {infer_time * 1000:.1f} ms")

if __name__ == "__main__":
    test_wav = Path("tests/fixtures/benchmark_sample.wav")
    generate_tone(test_wav, duration_sec=2.0)
    # Only run benchmark if explicitly passed --run to avoid downloading 500MB unconditionally
    import sys
    if "--run" in sys.argv:
        benchmark_latency(test_wav)
    else:
        print("Benchmark script ready. Run with: python ml/scripts/benchmark.py --run")
