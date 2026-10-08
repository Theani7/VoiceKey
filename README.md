# VoiceKey 🎙️

**Speak. Type. Done.**

Native Nepali voice typing utility for macOS, powered by Rust, Tauri 2, and the Kriti Nepali ASR engine.

---

## 🌟 Overview

VoiceKey lives in your macOS menu bar. Press `⌥ Space` (Option+Space), speak naturally in Nepali, and VoiceKey immediately types the Devanagari text at your cursor in any application:
- TextEdit, VS Code, Cursor
- Safari, Chrome, Firefox
- Slack, Discord, Telegram
- Terminal & standard macOS text fields

---

## 🏗️ Architecture

```text
macOS Microphone (CPAL)
       ↓
16kHz Mono Resampling
       ↓
Kriti ASR Model (Apple Silicon)
       ↓
Local Text Normalization (Danda ।, Numerals ०-९)
       ↓
macOS Accessibility Insertion (AXUIElement / CGEvent fallback)
       ↓
Active Cursor
```

### Key Modules

- [`crates/audio`](file:///Users/theanix/downloads/kirti/crates/audio): High-performance audio capture via `cpal` with real-time linear resampling to 16kHz mono.
- [`crates/text`](file:///Users/theanix/downloads/kirti/crates/text): Deterministic Nepali text normalizer handling terminal danda (`।`), punctuation spacing, consecutive stutter removal, and numeral conversion (`०-९`).
- [`crates/macos`](file:///Users/theanix/downloads/kirti/crates/macos): Native macOS Accessibility API integration via `AXUIElement` with clipboard paste fallback.
- [`crates/asr`](file:///Users/theanix/downloads/kirti/crates/asr): Speech recognizer trait and zero-latency IPC bridge to local ML runtime.
- [`apps/macos`](file:///Users/theanix/downloads/kirti/apps/macos): Native Tauri 2 menu-bar status utility with global keyboard shortcuts (`⌥ Space`) and settings dialog.
- [`ml`](file:///Users/theanix/downloads/kirti/ml): Python package for Kriti ASR inference, WER/CER evaluation, and Apple Silicon benchmarking.

---

## 🚀 Quick Start

### 1. Run Unit Tests

```bash
cargo test --workspace
```

### 2. Run CLI Transcriber

```bash
# Set up Python environment
source .venv/bin/activate

# Transcribe an audio file
python -m ml.transcribe tests/fixtures/sample_16k.wav
```

### 3. Build & Run VoiceKey macOS App

```bash
cargo build --package voicekey-app
```

---

## 🔒 Privacy & Permissions

- **100% Offline & Local**: Audio is never sent to the cloud.
- **Temporary Memory**: Audio buffers are processed and discarded immediately after transcription.
- **Permissions**: Requires macOS Microphone permission (for speech recording) and Accessibility permission (for typing text into focused applications).
